const express = require("express");
const cors = require("cors");
const axios = require("axios");
const zlib = require("zlib");

const app = express();
app.use(cors());

// ذاكرة تخزين مؤقت لحفظ الترجمة بعد توليدها لعدم استهلاك الحصة مرتين
const subtitleCache = new Map();

const manifest = {
    id: "org.fahd.najdiarabicsub",
    version: "1.0.0",
    name: "الترجمة العامية",
    description: "ترجمة فورية باللهجة العامية النجدية وشرح المعاني والأمثال (Gemini AI + محرك نجدي) مع ضبط التوقيت",
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

function convertToNajdiDialect(text) {
    let t = text;

    const phraseRules = [
        [/ماذا يحدث هنا/g, "وش السالفة هنا"],
        [/ما الذي يحدث/g, "وش قاعد يصير"],
        [/ماذا يحدث/g, "وش يصير"],
        [/ما خطبك/g, "وش فيك"],
        [/ما بك/g, "وش بلاك"],
        [/ما الأمر/g, "وش العلم"],
        [/هل تمزح معي/g, "تستهبل علي أنت"],
        [/هل تمزح/g, "تستهبل"],
        [/لا يهم/g, "ما يخالف"],
        [/لا بأس/g, "ما عليه"],
        [/على الإطلاق/g, "أبد"],
        [/بالطبع/g, "أكيد"],
        [/بالتأكيد/g, "إي والله"],
        [/ربما/g, "يمكن"],
        [/حسناً/g, "طيب"],
        [/حسنا/g, "طيب"],
        [/يا إلهي/g, "يا ساتر"],
        [/اللعنة/g, "يلعن بليسك"],
        [/تباً/g, "أفا"],
        [/مستحيل/g, "مهوب عاقل"],
        [/أعتقد أن/g, "أظن أن"],
        [/أعتقد/g, "هقوتي"],
        [/لا أعرف/g, "ما أدري"],
        [/لا أعلم/g, "مدري"],
        [/أريد أن/g, "أبي"],
        [/أريد/g, "أبي"],
        [/تريد/g, "تبي"],
        [/يريد/g, "يبي"],
        [/نريد/g, "نبي"],
        [/أنت محق/g, "صح عليك"],
        [/معك حق/g, "عز الله صدقت"],
        [/بسرعة/g, "عجل"],
        [/انتظر لحظة/g, "اصبر شوي"],
        [/انتظر/g, "اصبر"],
        [/تعال إلى هنا/g, "تعال جاي"],
        [/اذهب من هنا/g, "توكل على الله"],
        [/أغرب عن وجهي/g, "اقلب وجهك"],
        [/اصمت/g, "اسكت بس"],
        [/أغلق فمك/g, "سكر فمك"],
        [/كثيراً/g, "واجد"],
        [/كثيرا/g, "واجد"],
        [/قليلاً/g, "شوي"],
        [/قليلا/g, "شوي"],
        [/الآن/g, "الحين"],
        [/غداً/g, "بكرة"],
        [/غدا/g, "بكرة"],
        [/البارحة/g, "أمس"],
        [/هكذا/g, "كذا"],
        [/لماذا/g, "ليش"],
        [/كيف حالك/g, "وشلونك"],
        [/كيف/g, "وشلون"],
        [/أين/g, "وين"],
        [/من هذا/g, "منهو ذا"],
        [/ما هذا/g, "وش ذا"],
        [/ما هذه/g, "وش ذي"],
        [/ماذا/g, "وش"],
        [/أليس كذلك/g, "صح ولا لا"],
        [/ليس لدي/g, "ما عندي"],
        [/لا يوجد/g, "ما فيه"],
        [/يوجد/g, "فيه"],
        [/ليس/g, "مهوب"],
        [/ليست/g, "مهيب"],
        [/لست/g, "موب"],
        [/نعم/g, "إي"],
        [/كلا/g, "لا والله"],
        [/يا صاحبي/g, "يا خويي"],
        [/يا صديقي/g, "يا بعدي"],
        [/يا رجل/g, "يا رجال"],
        [/عزيزتي/g, "يا بعد حيي"],
        [/سيدي/g, "يا طويل العمر"],
        [/أبي/g, "أبوي"],
        [/أخي/g, "أخوي"]
    ];

    for (const [regex, replacement] of phraseRules) {
        t = t.replace(regex, replacement);
    }

    const wordRules = [
        [/\bهذا\b/g, "ذا"],
        [/\bهذه\b/g, "ذي"],
        [/\bهؤلاء\b/g, "ذولا"],
        [/\bذلك\b/g, "ذاك"],
        [/\bتلك\b/g, "ذيك"],
        [/\bالذي\b/g, "اللي"],
        [/\bالتي\b/g, "اللي"],
        [/\bالذين\b/g, "اللي"],
        [/\bأيضاً\b/g, "بعد"],
        [/\bأيضا\b/g, "بعد"],
        [/\bفقط\b/g, "بس"],
        [/\bجداً\b/g, "مرة"],
        [/\bجدا\b/g, "مرة"],
        [/\bسوف\b/g, "راح"],
        [/\bنحن\b/g, "حنا"],
        [/\bداخل\b/g, "جوا"],
        [/\bخارج\b/g, "برا"],
        [/\bأمام\b/g, "قدام"],
        [/\bخلف\b/g, "ورا"],
        [/\bبجانب\b/g, "جنب"],
        [/\bمثل\b/g, "زي"],
        [/\bنقود\b/g, "دراهم"],
        [/\bالمال\b/g, "الدراهم"],
        [/\bسيارة\b/g, "موتر"],
        [/\bالسيارة\b/g, "الموتر"],
        [/\bجميل\b/g, "زين"],
        [/\bجيد\b/g, "زين"],
        [/\bسيء\b/g, "شين"],
        [/\bانظر\b/g, "شف"],
        [/\bأعطني\b/g, "عطني"],
        [/\bدعني\b/g, "خلني"],
        [/\bدعنا\b/g, "خلنا"],
        [/\bاتركه\b/g, "خله"]
    ];

    for (const [regex, replacement] of wordRules) {
        t = t.replace(regex, replacement);
    }

    t = t.replace(/\[([^\]]+)\]/g, (match, inside) => {
        let sdh = inside
            .replace(/يتنهد/g, "يتنهد بضيقة")
            .replace(/تتنهد/g, "تتنهد بضيقة")
            .replace(/يسعل/g, "يكح")
            .replace(/سعال/g, "كحة")
            .replace(/خطوات/g, "صوت مشي")
            .replace(/صراخ/g, "صياح");
        return `[${sdh}]`;
    });

    return t;
}

async function fallbackTranslateChunk(chunk) {
    const combinedText = chunk.map(b => b.text).join('\n');
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(combinedText)}`;
        const res = await axios.get(url, {
            timeout: 6000,
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        const translatedFull = res.data[0].map(item => item[0]).join('');
        const translatedLines = translatedFull.split('\n');

        chunk.forEach((b, idx) => {
            const rawArabic = (translatedLines[idx] && translatedLines[idx].trim()) ? translatedLines[idx].trim() : b.text;
            b.translated = convertToNajdiDialect(rawArabic);
        });
    } catch (err) {
        chunk.forEach(b => { b.translated = b.text; });
    }
}

async function translateChunkToNajdi(chunk) {
    const geminiKey = process.env.GEMINI_API_KEY;

    if (geminiKey) {
        try {
            const numberedInput = chunk.map((b, i) => `${i + 1}|||${b.text}`).join('\n');
            const prompt = `أنت مترجم أفلام ومسلسلات سعودي خبير باللهجة العامية النجدية (الرياض والقصيم).
ترجم أسطر الترجمة الإنجليزية التالية إلى اللهجة العامية النجدية الطبيعية:
1. حول الكلام والأمثال الشعبية والنكات والمصطلحات الإنجليزية (Idioms/Slang) إلى ما يقابلها في المعنى باللهجة النجدية الأصيلة (مثل: وش السالفة، يا رجال، هقوتي، ما يخالف، عجل، الدراهم، الموتر، يستهبل، ذولا، مهوب)، وإذا كان هناك مصطلح غامض اشرح معناه باختصار بالنجدي.
2. حافظ على أقواس المؤثرات الصوتية [SDH] وترجم ما بداخلها باللهجة النجدية.
3. أخرج الترجمة فقط بنفس رقم السطر متبوعاً بالفاصل ||| دون أي كلام إضافي.

النص:
${numberedInput}`;

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
            const response = await axios.post(geminiUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.25,
                    thinkingConfig: { thinkingBudget: 0 }
                }
            }, { timeout: 6500 });

            const aiOutput = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const map = {};
            aiOutput.split('\n').forEach(line => {
                const parts = line.split('|||');
                if (parts.length >= 2) {
                    const idx = parseInt(parts[0].replace(/[^\d]/g, ''), 10) - 1;
                    if (!isNaN(idx)) {
                        map[idx] = parts.slice(1).join('|||').trim();
                    }
                }
            });

            if (Object.keys(map).length >= chunk.length * 0.6) {
                // إذا بقي أي سطر ناقص يكمله المحرك النجدي المدمج فوراً
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
            // ينتقل تلقائياً للمحرك السريع عند انتهاء المهلة أو ضغط الشبكة
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

    // تقسيم الحجم إلى 45 سطراً لتقليل عدد الطلبات وتسريع الاستجابة
    const chunkSize = 45;
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

        const translatedSubtitles = topSubs.map((sub, index) => {
            const matchLabel = sub.badge ? ` [${sub.badge}]` : '';
            return {
                id: index === 0
                    ? `الترجمة العامية-1 (${sub.source})${matchLabel}`
                    : `الترجمة العامية-${index + 1} (${sub.source})${matchLabel}`,
                url: `${host}/translate-najdi.srt?url=${encodeURIComponent(sub.url)}`,
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

    if (subtitleCache.has(subUrl)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(subtitleCache.get(subUrl));
    }

    try {
        const rawSrt = await fetchRawSrt(subUrl);
        const najdiSrt = await translateSrtToNajdi(rawSrt);

        if (subtitleCache.size > 50) {
            const firstKey = subtitleCache.keys().next().value;
            subtitleCache.delete(firstKey);
        }
        subtitleCache.set(subUrl, najdiSrt);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(najdiSrt);
    } catch (error) {
        res.status(500).send("Error translating subtitle");
    }
});

const port = process.env.PORT || 7000;
if (require.main === module) {
    app.listen(port, () => console.log(`Najdi Addon active on port ${port}`));
}

module.exports = app;
