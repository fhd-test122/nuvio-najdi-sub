const express = require("express");
const cors = require("cors");
const axios = require("axios");
const zlib = require("zlib");

const app = express();
app.use(cors());

const subtitleCache = new Map();

const manifest = {
    id: "org.fahd.najdiarabicsub",
    version: "1.1.0",
    name: "الترجمة العامية (نجدي قح)",
    description: "ترجمة كاملة باللهجة العامية النجدية وشرح المعاني والأمثال (Gemini AI + محول قواعد نجدي عميق)",
    resources: [
        {
            name: "subtitles",
            types: ["movie", "series"],
            idPrefixes: ["tt"]
        }
    ],
    types: ["movie", "series"],
    catalogs: []
};

function parseExtraParams(extraStr) {
    const params = {};
    if (!extraStr) return params;
    const clean = extraStr.replace(/\.json$/, '');
    clean.split('&').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx !== -1) {
            const key = pair.slice(0, idx);
            const val = decodeURIComponent(pair.slice(idx + 1));
            params[key] = val;
        }
    });
    return params;
}

function calculateMatchScore(sub, videoFilename, hasVideoHash, sourceName, indexInSource) {
    let score = 0;
    let badge = "";

    if (sourceName === "OpenSub" && hasVideoHash && indexInSource === 0) {
        score += 100;
        badge = "Hash-Match";
    }

    const subText = `${sub.id || ''} ${sub.url || ''} ${sub.title || ''} ${sub.release || ''}`.toLowerCase();
    const vidText = (videoFilename || '').toLowerCase();

    if (vidText) {
        const sources = [
            { tag: "WEB", keys: ["web-dl", "webrip", "web.", ".web"] },
            { tag: "BluRay", keys: ["bluray", "bdrip", "brrip", "remux"] },
            { tag: "HDTV", keys: ["hdtv", "pdtv", "dsr"] },
            { tag: "DVD", keys: ["dvdrip", "dvd"] }
        ];

        for (const src of sources) {
            const vidHas = src.keys.some(k => vidText.includes(k));
            const subHas = src.keys.some(k => subText.includes(k));
            if (vidHas && subHas) {
                score += 35;
                if (!badge) badge = src.tag;
            }
        }

        const resolutions = ["2160p", "1080p", "720p", "480p"];
        for (const res of resolutions) {
            if (vidText.includes(res) && subText.includes(res)) {
                score += 15;
            }
        }

        const cleanVidName = vidText.replace(/\.[a-z0-9]{2,4}$/, '');
        const groupMatch = cleanVidName.match(/[-.]([a-z0-9]{2,12})$/i);
        if (groupMatch && groupMatch[1]) {
            const releaseGroup = groupMatch[1].toLowerCase();
            const ignoredWords = ["mkv", "mp4", "avi", "x264", "x265", "hevc", "aac", "ac3", "1080p", "720p"];
            if (!ignoredWords.includes(releaseGroup) && subText.includes(releaseGroup)) {
                score += 55;
                badge = `${releaseGroup.toUpperCase()}-Match`;
            }
        }
    }

    return { score, badge };
}

async function fetchRawSrt(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 6000,
        headers: { "User-Agent": "Mozilla/5.0" }
    });
    const buffer = Buffer.from(response.data);
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
        return zlib.gunzipSync(buffer).toString('utf-8');
    }
    return buffer.toString('utf-8');
}

// محرك قواعد وتراكيب اللهجة النجدية العميق (يحول أي نص فصيح إلى عامية نجدية 100%)
function convertToNajdiDialect(text) {
    if (!text) return text;
    let t = text;

    // 1. إزالة التشكيل الفصيح مثل التنوين (اً) في نهاية الكلمات الشائعة
    t = t
        .replace(/شكراً لك/g, "ما قصرت")
        .replace(/شكرا لك/g, "ما قصرت")
        .replace(/شكراً جزيلاً/g, "الله يعطيك العافية")
        .replace(/شكراً/g, "يعطيك العافية")
        .replace(/شكرا/g, "يعطيك العافية")
        .replace(/عفواً/g, "حياك")
        .replace(/مرحباً/g, "يا هلا")
        .replace(/مرحبا/g, "يا هلا")
        .replace(/أهلاً بك/g, "يا هلا والله")
        .replace(/أهلاً/g, "هلا")
        .replace(/وداعاً/g, "فمان الله")
        .replace(/إلى اللقاء/g, "نشوفك على خير")
        .replace(/صباح الخير/g, "صباح النور")
        .replace(/مساء الخير/g, "مساء النور")
        .replace(/تصبح على خير/g, "تمسي على خير");

    // 2. تحويل العبارات والجمل المركبة بالكامل إلى تعبيرات نجدية
    const phraseRules = [
        [/ما الذي تتحدث عنه/g, "وش قاعد تقول أنت"],
        [/عما تتحدث/g, "وش تخرط به"],
        [/ماذا تقصد/g, "وش قصدك"],
        [/ما الذي تفعله/g, "وش قاعد تسوي"],
        [/ماذا تفعل هنا/g, "وش جابك هنا"],
        [/ماذا تفعل/g, "وش تسوي"],
        [/ماذا سنفعل/g, "وش السواة الحين"],
        [/ماذا سأفعل/g, "وش ابسوي"],
        [/ماذا حدث/g, "وش صار"],
        [/ما الذي حدث/g, "وش اللي صار"],
        [/ماذا يحدث هنا/g, "وش السالفة هنا"],
        [/ما الذي يحدث/g, "وش صاير"],
        [/ماذا يحدث/g, "وش يصير"],
        [/ما خطبك/g, "وش فيك"],
        [/ما بك/g, "وش بلاك"],
        [/ما المشكلة/g, "وش المشكلة"],
        [/ما الأمر/g, "وش العلم"],
        [/هل أنت بخير/g, "عساك طيب"],
        [/أنا بخير/g, "أنا طيب وبخير"],
        [/هل أنت متأكد/g, "متأكد أنت"],
        [/هل أنت مجنون/g, "أنت صاحي ولا مهبول"],
        [/هل فقدت عقلك/g, "أنت انهبلت"],
        [/هل تمزح معي/g, "تستهبل علي أنت"],
        [/هل تمزح/g, "تستهبل"],
        [/لا تمزح/g, "لا تستهبل"],
        [/على محمل الجد/g, "من جدك"],
        [/هل تتكلم بجدية/g, "تتكلم من جدك"],
        [/أقسم لك/g, "والله العظيم"],
        [/أعدك/g, "أبشر من عيوني"],
        [/صدقني/g, "صدقني والله"],
        [/لا أصدق ذلك/g, "ماني مصدق"],
        [/لا أصدق/g, "ما أصدق"],
        [/من المستحيل/g, "ما فيه أمل"],
        [/مستحيل/g, "مهوب عاقل"],
        [/يا إلهي/g, "يا ساتر"],
        [/بحق الجحيم/g, "وش هالمصيبة"],
        [/بحق السماء/g, "يا ساتر استر"],
        [/اللعنة عليك/g, "حسبي الله عليك"],
        [/اللعنة/g, "يلعن بليسك"],
        [/تباً لك/g, "أفا بس"],
        [/تباً/g, "يا ليل"],
        [/سحقاً/g, "يا ساتر"],
        [/هراء/g, "كلام فاضي"],
        [/هذا هراء/g, "ذا حكي فاضي"],
        [/لا يهم/g, "ما يخالف"],
        [/لا بأس/g, "ما عليه"],
        [/لا تقلق/g, "لا تشيل هم"],
        [/اهدأ/g, "هد اللعب"],
        [/استرخ/g, "وسع صدرك"],
        [/على الإطلاق/g, "أبد والله"],
        [/بالتأكيد/g, "أكيد"],
        [/بالطبع/g, "طبعاً"],
        [/حسناً إذاً/g, "طيب أجل"],
        [/حسناً/g, "طيب"],
        [/حسنا/g, "طيب"],
        [/أعتقد أنني/g, "هقوتي أني"],
        [/أعتقد أن/g, "أظن أن"],
        [/أعتقد ذلك/g, "هقوتي كذا"],
        [/أعتقد/g, "هقوتي"],
        [/لا أعتقد ذلك/g, "ما هقيت"],
        [/لا أعرف/g, "ما أدري"],
        [/لا أعلم/g, "والله مدري"],
        [/ليس لدي فكرة/g, "ما عندي أي علم"],
        [/هل تعرف/g, "تدري"],
        [/هل تعلم/g, "تدري"],
        [/كما تعلم/g, "مثل ما أنت خابر"],
        [/أنت تعلم/g, "أنت خابر"],
        [/أفهم ذلك/g, "فاهم عليك"],
        [/لا أفهم/g, "ما فهمت"],
        [/هل تفهم/g, "فهمت علي"],
        [/أريد أن/g, "أبي"],
        [/أريدك أن/g, "أبيك"],
        [/لا أريد أن/g, "ما أبي"],
        [/لا أريد/g, "ما أبي"],
        [/أريد/g, "أبي"],
        [/ماذا تريد/g, "وش تبي"],
        [/هل تريد/g, "تبي"],
        [/تريد أن/g, "تبي"],
        [/تريد/g, "تبي"],
        [/يريد أن/g, "يبي"],
        [/يريد/g, "يبي"],
        [/تريدين/g, "تبين"],
        [/نريد أن/g, "نبي"],
        [/نريد/g, "نبي"],
        [/يريدون/g, "يبون"],
        [/كنت أريد/g, "كان ودي"],
        [/أود أن/g, "ودي"],
        [/يجب أن أذهب/g, "لازم أمشي الحين"],
        [/يجب أن نذهب/g, "لازم نمشي"],
        [/يجب عليك/g, "لازم عليك"],
        [/يجب أن/g, "لازم"],
        [/يتوجب علينا/g, "لازم علينا"],
        [/عليك أن/g, "لازم"],
        [/علينا أن/g, "لازم"],
        [/لا يمكنك/g, "ما تقدر"],
        [/لا أستطيع/g, "ما أقدر"],
        [/هل يمكنك/g, "تقدر"],
        [/هل تستطيع/g, "تقدر"],
        [/أستطيع/g, "أقدر"],
        [/نستطيع/g, "نقدر"],
        [/ربما/g, "يمكن"],
        [/من الممكن/g, "يمدي"],
        [/أنت محق/g, "صح عليك"],
        [/معك حق/g, "عز الله صدقت"],
        [/هذا صحيح/g, "إي بالله صح"],
        [/ليس صحيحاً/g, "مهوب صدق"],
        [/بسرعة/g, "عجل"],
        [/أسرع/g, "عجل علينا"],
        [/انتظر لحظة/g, "اصبر شوي"],
        [/انتظر دقيقة/g, "اصبر دقيقة"],
        [/انتظر/g, "اصبر"],
        [/توقف عن ذلك/g, "فكنا من هالحركات"],
        [/توقف/g, "وقف"],
        [/تعال إلى هنا/g, "تعال جاي"],
        [/تعال معي/g, "امش معي"],
        [/هيا بنا/g, "يلا مشينا"],
        [/هيا/g, "يلا"],
        [/لنذهب/g, "مشينا"],
        [/اذهب من هنا/g, "توكل على الله"],
        [/ابتعد عني/g, "وخر عني"],
        [/ابتعد/g, "وخر"],
        [/أغرب عن وجهي/g, "اقلب وجهك"],
        [/اصمت/g, "اسكت بس"],
        [/أغلق فمك/g, "سكر فمك"],
        [/اسمعني/g, "اسمع كلامي"],
        [/انظر إلى هذا/g, "شف ذا بالله"],
        [/انظر إلي/g, "طالع فيني"],
        [/من فضلك/g, "لا هنت"],
        [/أرجوك/g, "تكفى"],
        [/أتوسل إليك/g, "تكفى طلبتك"],
        [/أنا آسف/g, "حقك علي، آسف"],
        [/آسف/g, "المعذرة"],
        [/أعتذر/g, "أعتذر منك"],
        [/في الحقيقة/g, "الصراحة"],
        [/في الواقع/g, "الصدق عاد"],
        [/بصراحة/g, "الصراحة"],
        [/على أي حال/g, "المهم"],
        [/بالمناسبة/g, "على طاري هالموضوع"],
        [/منذ فترة/g, "من زمان"],
        [/منذ وقت طويل/g, "من مبطي"],
        [/طوال الوقت/g, "طول الوقت"],
        [/في كل مكان/g, "بكل مكان"],
        [/لا أحد/g, "ما فيه أحد"],
        [/كل شيء/g, "كلش"],
        [/أي شيء/g, "أي شي"],
        [/شيء ما/g, "شي"],
        [/لا شيء/g, "ولا شي"],
        [/كثيراً/g, "واجد"],
        [/كثيرا/g, "واجد"],
        [/قليلاً/g, "شوي"],
        [/قليلا/g, "شوي"],
        [/الآن/g, "الحين"],
        [/حتى الآن/g, "للحين"],
        [/بعد الآن/g, "من اليوم ورايح"],
        [/لاحقاً/g, "بعدين"],
        [/فيما بعد/g, "بعدين"],
        [/فوراً/g, "الحين على طول"],
        [/حالا/g, "الحين"],
        [/غداً/g, "بكرة"],
        [/غدا/g, "بكرة"],
        [/البارحة/g, "أمس"],
        [/الليلة الماضية/g, "البارح"],
        [/هكذا/g, "كذا"],
        [/مثل هذا/g, "زي كذا"],
        [/لماذا/g, "ليش"],
        [/كيف حالك/g, "وشلونك"],
        [/كيف/g, "وشلون"],
        [/إلى أين/g, "على وين"],
        [/من أين/g, "من وين"],
        [/أين/g, "وين"],
        [/من هذا/g, "منهو ذا"],
        [/من هذه/g, "منهي ذي"],
        [/ما هذا/g, "وش ذا"],
        [/ما هذه/g, "وش ذي"],
        [/ما ذلك/g, "وش ذاك"],
        [/ماذا/g, "وش"],
        [/أليس كذلك/g, "صح ولا لا"],
        [/ليس لدي/g, "ما عندي"],
        [/لدي/g, "عندي"],
        [/لديك/g, "عندك"],
        [/لديه/g, "عنده"],
        [/لديها/g, "عندها"],
        [/لدينا/g, "عندنا"],
        [/ليس هناك/g, "ما فيه"],
        [/لا يوجد/g, "ما فيه"],
        [/هل هناك/g, "فيه"],
        [/هل يوجد/g, "فيه"],
        [/هناك/g, "فيه"],
        [/يوجد/g, "فيه"],
        [/لم أكن/g, "ما كنت"],
        [/لم يكن/g, "ما كان"],
        [/لم تكن/g, "ما كانت"],
        [/لن أكون/g, "ماراح أكون"],
        [/سأكون/g, "ابكون"],
        [/سيكون/g, "بيكون"],
        [/ستكون/g, "بتكون"],
        [/ليس/g, "مهوب"],
        [/ليست/g, "مهيب"],
        [/لست/g, "موب"],
        [/لسنا/g, "ما حنا"],
        [/نعم/g, "إي"],
        [/أجل/g, "إي والله"],
        [/كلا/g, "لا والله"],
        [/يا صاحبي/g, "يا خويي"],
        [/يا صديقي/g, "يا بعدي"],
        [/يا رفاق/g, "يا عيال"],
        [/يا شباب/g, "يا العيال"],
        [/يا رجل/g, "يا رجال"],
        [/أيها الرجل/g, "يا ابن الحلال"],
        [/عزيزتي/g, "يا بعد حيي"],
        [/حبيبتي/g, "يا غلاي"],
        [/حبيبي/g, "يا بعدي"],
        [/سيدي/g, "يا طويل العمر"],
        [/سيدتي/g, "يا طويلة العمر"]
    ];

    for (const [regex, replacement] of phraseRules) {
        t = t.replace(regex, replacement);
    }

    // 3. تحويل قواعد النفي والمستقبل الفصيحة (سوف / سـ / لن / لم) إلى القواعد النجدية
    t = t
        .replace(/\bسوف أ([^\s]+)/g, "اب$1")
        .replace(/\bسوف ن([^\s]+)/g, "بن$1")
        .replace(/\bسوف ي([^\s]+)/g, "بي$1")
        .replace(/\bسوف ت([^\s]+)/g, "بت$1")
        .replace(/\bسأذهب\b/g, "ابروح")
        .replace(/\bسنذهب\b/g, "بنروح")
        .replace(/\bسيذهب\b/g, "بيروح")
        .replace(/\bستذهب\b/g, "بتروح")
        .replace(/\bسأفعل\b/g, "ابسوي")
        .replace(/\bسأعود\b/g, "ابرجع")
        .replace(/\bسأخبرك\b/g, "ابقولك")
        .replace(/\bسأتصل\b/g, "ابدق")
        .replace(/\bسأقتل\b/g, "ابذبح")
        .replace(/\bسأموت\b/g, "ابموت")
        .replace(/\bسأرى\b/g, "ابشوف")
        .replace(/\bلن أ([^\s]+)/g, "ماراح أ$1")
        .replace(/\bلن ن([^\s]+)/g, "ماراح ن$1")
        .replace(/\bلن ي([^\s]+)/g, "ماراح ي$1")
        .replace(/\bلن ت([^\s]+)/g, "ماراح ت$1")
        .replace(/\bلم أ([^\s]+)/g, "ما أ$1")
        .replace(/\bلم ن([^\s]+)/g, "ما ن$1")
        .replace(/\bلم ي([^\s]+)/g, "ما ي$1")
        .replace(/\bلم ت([^\s]+)/g, "ما ت$1")
        .replace(/\bلا ت([^\s]+)/g, "لا ت$1")
        .replace(/\bهل أ([^\s]+)/g, "أ$1")
        .replace(/\bهل ت([^\s]+)/g, "ت$1")
        .replace(/\bهل ي([^\s]+)/g, "ي$1")
        .replace(/\bهل ن([^\s]+)/g, "ن$1")
        .replace(/\bلقد\b/g, "");

    // 4. تحويل الكلمات والمفردات الفصحى الشائعة إلى مفردات نجدية
    const wordRules = [
        [/\bهذا\b/g, "ذا"],
        [/\bهذه\b/g, "ذي"],
        [/\bهؤلاء\b/g, "ذولا"],
        [/\bأولئك\b/g, "ذوليك"],
        [/\bذلك\b/g, "ذاك"],
        [/\bتلك\b/g, "ذيك"],
        [/\bالذي\b/g, "اللي"],
        [/\bالتي\b/g, "اللي"],
        [/\bالذين\b/g, "اللي"],
        [/\bاللذان\b/g, "اللي"],
        [/\bأيضاً\b/g, "بعد"],
        [/\bأيضا\b/g, "بعد"],
        [/\bفقط\b/g, "بس"],
        [/\bجداً\b/g, "مرة"],
        [/\bجدا\b/g, "مرة"],
        [/\bنحن\b/g, "حنا"],
        [/\bأبي\b/g, "أبوي"],
        [/\bوالدي\b/g, "الوالد"],
        [/\bوالدتي\b/g, "الوالدة"],
        [/\bأخي\b/g, "أخوي"],
        [/\bداخل\b/g, "جوا"],
        [/\bخارج\b/g, "برا"],
        [/\bأمام\b/g, "قدام"],
        [/\bخلف\b/g, "ورا"],
        [/\bبجانب\b/g, "جنب"],
        [/\bفوق\b/g, "فوق"],
        [/\bتحت\b/g, "تحت"],
        [/\bمثل\b/g, "زي"],
        [/\bنقود\b/g, "دراهم"],
        [/\bالمال\b/g, "الدراهم"],
        [/\bأموال\b/g, "دراهم"],
        [/\bسيارة\b/g, "موتر"],
        [/\bالسيارة\b/g, "الموتر"],
        [/\bمنزل\b/g, "بيت"],
        [/\bالمنزل\b/g, "البيت"],
        [/\bعمل\b/g, "شغل"],
        [/\bالعمل\b/g, "الشغل"],
        [/\bطعام\b/g, "أكل"],
        [/\bالطعام\b/g, "الأكل"],
        [/\bماء\b/g, "موية"],
        [/\bالماء\b/g, "الموية"],
        [/\bملابس\b/g, "هدوم"],
        [/\bالملابس\b/g, "الهدوم"],
        [/\bهاتف\b/g, "جوال"],
        [/\bالهاتف\b/g, "الجوال"],
        [/\bشرطة\b/g, "دورية"],
        [/\bالشرطة\b/g, "الشرطة"],
        [/\bطبيب\b/g, "دكتور"],
        [/\bالطبيب\b/g, "الدكتور"],
        [/\bجميل\b/g, "زين"],
        [/\bجيد\b/g, "زين"],
        [/\bرائع\b/g, "رهيب"],
        [/\bسيء\b/g, "شين"],
        [/\bغريب\b/g, "غريب"],
        [/\bمجنون\b/g, "مهبول"],
        [/\bغبي\b/g, "دبشة"],
        [/\bأحمق\b/g, "خبل"],
        [/\bكاذب\b/g, "نصاب"],
        [/\bصحيح\b/g, "صح"],
        [/\bانظر\b/g, "شف"],
        [/\bانظري\b/g, "شوفي"],
        [/\bانظروا\b/g, "شوفوا"],
        [/\bأعطني\b/g, "عطني"],
        [/\bدعني\b/g, "خلني"],
        [/\bدعنا\b/g, "خلنا"],
        [/\bاتركه\b/g, "خله"],
        [/\bاتركها\b/g, "خلها"],
        [/\bاذهب\b/g, "رح"],
        [/\bاذهبي\b/g, "روحي"],
        [/\bنذهب\b/g, "نروح"],
        [/\bأذهب\b/g, "أروح"],
        [/\bيذهب\b/g, "يروح"],
        [/\bتذهب\b/g, "تروح"],
        [/\bجاء\b/g, "جا"],
        [/\bأتى\b/g, "جا"],
        [/\bرأيت\b/g, "شفت"],
        [/\bأرى\b/g, "أشوف"],
        [/\bترى\b/g, "تشوف"],
        [/\bيرى\b/g, "يشوف"],
        [/\bنرى\b/g, "نشوف"],
        [/\bقلت\b/g, "قلت"],
        [/\bفعلت\b/g, "سويت"],
        [/\bفعل\b/g, "سوى"],
        [/\bأفعل\b/g, "أسوي"],
        [/\bتفعل\b/g, "تسوي"],
        [/\bيفعل\b/g, "يسوي"],
        [/\bنفعل\b/g, "نسوي"],
        [/\bتحدث\b/g, "تكلم"],
        [/\bأتحدث\b/g, "أتكلم"],
        [/\bيتحدث\b/g, "يتكلم"],
        [/\bتتحدث\b/g, "تتكلم"]
    ];

    for (const [regex, replacement] of wordRules) {
        t = t.replace(regex, replacement);
    }

    // 5. تعريب أقواس المؤثرات الصوتية [SDH] إلى لهجة نجدية
    t = t.replace(/\[([^\]]+)\]/g, (match, inside) => {
        let sdh = inside
            .replace(/يتنهد/g, "يتنهد بضيقة")
            .replace(/تتنهد/g, "تتنهد بضيقة")
            .replace(/لهاث/g, "يلقط أنفاسه")
            .replace(/يلهث/g, "يلقط أنفاسه")
            .replace(/يسعل/g, "يكح")
            .replace(/سعال/g, "كحة")
            .replace(/خطوات/g, "صوت مشي")
            .replace(/صراخ/g, "صياح")
            .replace(/يصرخ/g, "يصايح")
            .replace(/تصرخ/g, "تصايح")
            .replace(/يبكي/g, "يصيح")
            .replace(/تبكي/g, "تصيح")
            .replace(/بكاء/g, "صياح")
            .replace(/يضحك/g, "يضحك")
            .replace(/قهقهة/g, "ضحك بصوت عالي")
            .replace(/همس/g, "يتساسر");
        return `[${sdh}]`;
    });

    return t.replace(/\s+/g, ' ').trim();
}

async function fallbackTranslateChunk(chunk) {
    const subSize = 40;
    const subChunks = [];
    for (let i = 0; i < chunk.length; i += subSize) {
        subChunks.push(chunk.slice(i, i + subSize));
    }

    await Promise.all(subChunks.map(async (subChunk) => {
        const combinedText = subChunk.map(b => b.text).join('\n');
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(combinedText)}`;
            const res = await axios.get(url, {
                timeout: 6000,
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            const translatedFull = res.data[0].map(item => item[0]).join('');
            const translatedLines = translatedFull.split('\n');

            subChunk.forEach((b, idx) => {
                const rawArabic = (translatedLines[idx] && translatedLines[idx].trim()) ? translatedLines[idx].trim() : b.text;
                b.translated = convertToNajdiDialect(rawArabic);
            });
        } catch (err) {
            subChunk.forEach(b => { b.translated = b.text; });
        }
    }));
}

async function translateChunkToNajdi(chunk) {
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (geminiKey) {
        try {
            const numberedInput = chunk.map((b, i) => `${i + 1}|||${b.text}`).join('\n');
            const systemPrompt = `أنت مترجم سعودي من نجد (الرياض والقصيم). مهمتك ترجمة حوارات الأفلام والمسلسلات من الإنجليزية إلى اللهجة العامية النجدية القحة فقط.
يُمنع منعاً باتاً استخدام اللغة العربية الفصحى مثل (ماذا، لماذا، سوف، هذا، حسناً، أريد، لا أعلم، تباً).
استبدلها دائماً بمرادفاتها النجدية الطبيعية مثل: (وش السالفة، ليش، وشلون، ابروح، ذا، ذي، ذولا، طيب، أبي، تبي، مدري، هقوتي، ما يخالف، يا رجال، يستهبل، الدراهم، الموتر، عجل، واجد، شوي، الحين، مهوب).
ترجم الأمثال والمصطلحات الإنجليزية (Idioms/Slang) إلى معناها باللهجة النجدية، وحافظ على أقواس المؤثرات الصوتية [SDH] باللهجة النجدية.
أخرج كل سطر بنفس رقمه متبوعاً بـ ||| ثم الترجمة النجدية فقط بدون أي مقدمات.`;

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
            const response = await axios.post(geminiUrl, {
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: [{ parts: [{ text: numberedInput }] }],
                generationConfig: {
                    temperature: 0.35,
                    thinkingConfig: { thinkingBudget: 0 }
                }
            }, { timeout: 8000 });

            const aiOutput = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const map = {};
            aiOutput.split('\n').forEach(line => {
                const parts = line.split('|||');
                if (parts.length >= 2) {
                    const idx = parseInt(parts[0].replace(/[^\d]/g, ''), 10) - 1;
                    if (!isNaN(idx)) {
                        // تمرير ناتج Gemini أيضاً على الفلتر النجدي لضمان 0% فصحى
                        map[idx] = convertToNajdiDialect(parts.slice(1).join('|||').trim());
                    }
                }
            });

            if (Object.keys(map).length >= chunk.length * 0.5) {
                const missing = chunk.filter((_, idx) => !map[idx]);
                if (missing.length > 0) {
                    await fallbackTranslateChunk(missing);
                }
                chunk.forEach((b, idx) => {
                    if (map[idx]) b.translated = map[idx];
                });
                return;
            }
        } catch (e) {
            // في حال ضغط الشبكة أو تجاوز حد Gemini ينتقل فوراً للمحرك النجدي العميق
        }
    }

    await fallbackTranslateChunk(chunk);
}

async function translateSrtToNajdi(srtContent) {
    const cleanSrt = srtContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = cleanSrt.split(/\n\n+/);
    const parsedBlocks = [];

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length >= 2) {
            const timeIndex = lines.findIndex(l => l.includes('-->'));
            if (timeIndex !== -1) {
                const textLines = lines.slice(timeIndex + 1).join(' ')
                    .replace(/<\/?[^>]+(>|$)/g, '')
                    .trim();
                if (textLines) {
                    parsedBlocks.push({
                        id: parsedBlocks.length + 1,
                        time: lines[timeIndex].trim(),
                        text: textLines
                    });
                }
            }
        }
    }

    // تقسيم الحلقة إلى دفعات كبيرة (200 سطر) لعدم تجاوز حد طلبات Gemini المجاني في الدقيقة
    const chunkSize = 200;
    const chunks = [];
    for (let i = 0; i < parsedBlocks.length; i += chunkSize) {
        chunks.push(parsedBlocks.slice(i, i + chunkSize));
    }

    await Promise.all(chunks.map(chunk => translateChunkToNajdi(chunk)));

    return parsedBlocks.map(b => `${b.id}\n${b.time}\n${b.translated}`).join('\n\n') + '\n';
}

app.get('/', (req, res) => {
    res.redirect('/manifest.json');
});

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get(['/subtitles/:type/:id/:extra.json', '/subtitles/:type/:id.json'], async (req, res) => {
    try {
        const { type, id, extra } = req.params;
        const cleanId = id.replace(/\.json$/, '');
        const cleanExtra = extra ? extra.replace(/\.json$/, '') : '';
        const extraPath = cleanExtra ? `/${cleanExtra}` : '';

        const extraParams = parseExtraParams(cleanExtra);
        const videoFilename = extraParams.filename || '';
        const hasVideoHash = Boolean(extraParams.videoHash);
        const hasGemini = Boolean((process.env.GEMINI_API_KEY || '').trim());

        const sources = [
            { name: "OpenSub", url: `https://opensubtitles-v3.strem.io/subtitles/${type}/${cleanId}${extraPath}.json` },
            { name: "SubDL", url: `https://subdl.strem.top/subtitles/${type}/${cleanId}${extraPath}.json` },
            { name: "OS-Pro", url: `https://opensubtitles.stremio.ru/subtitles/${type}/${cleanId}${extraPath}.json` }
        ];

        const results = await Promise.allSettled(
            sources.map(src => axios.get(src.url, { timeout: 4500 }).then(r => ({
                sourceName: src.name,
                subs: r.data.subtitles || []
            })))
        );

        let scoredSubs = [];
        const seenUrls = new Set();

        for (const result of results) {
            if (result.status === 'fulfilled' && Array.isArray(result.value.subs)) {
                const engList = result.value.subs.filter(sub => {
                    const lang = (sub.lang || '').toLowerCase();
                    return (lang === 'eng' || lang === 'en' || lang.includes('english') || lang.includes('sdh'));
                });

                engList.forEach((sub, idx) => {
                    if (sub.url && !seenUrls.has(sub.url)) {
                        seenUrls.add(sub.url);
                        const { score, badge } = calculateMatchScore(
                            sub,
                            videoFilename,
                            hasVideoHash,
                            result.value.sourceName,
                            idx
                        );
                        scoredSubs.push({
                            url: sub.url,
                            source: result.value.sourceName,
                            score,
                            badge
                        });
                    }
                });
            }
        }

        scoredSubs.sort((a, b) => b.score - a.score);

        const topSubs = scoredSubs.slice(0, 8);
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = `${protocol}://${req.get('host')}`;
        const aiTag = hasGemini ? "نجدي-AI" : "نجدي";

        const translatedSubtitles = topSubs.map((sub, index) => {
            const matchLabel = sub.badge ? ` [${sub.badge}]` : '';
            return {
                id: index === 0
                    ? `الترجمة العامية-1 (${aiTag} | ${sub.source})${matchLabel}`
                    : `الترجمة العامية-${index + 1} (${aiTag} | ${sub.source})${matchLabel}`,
                url: `${host}/translate-najdi.srt?v=2&url=${encodeURIComponent(sub.url)}`,
                lang: "ara"
            };
        });

        res.json({ subtitles: translatedSubtitles });
    } catch (e) {
        res.json({ subtitles: [] });
    }
});

app.get(['/translate-najdi.srt', '/translate.srt', '/translate'], async (req, res) => {
    const subUrl = req.query.url;
    if (!subUrl) return res.status(400).send("Missing URL");

    const cacheKey = `v2_${subUrl}`;
    if (subtitleCache.has(cacheKey)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(subtitleCache.get(cacheKey));
    }

    try {
        const rawSrt = await fetchRawSrt(subUrl);
        const najdiSrt = await translateSrtToNajdi(rawSrt);

        if (subtitleCache.size > 50) {
            const firstKey = subtitleCache.keys().next().value;
            subtitleCache.delete(firstKey);
        }
        subtitleCache.set(cacheKey, najdiSrt);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(najdiSrt);
    } catch (error) {
        res.status(500).send("Error translating subtitle");
    }
});

const port = process.env.PORT || 7000;
if (require.main === module) {
    app.listen(port, () => console.log(`Najdi Addon v1.1.0 active on port ${port}`));
}

module.exports = app;
