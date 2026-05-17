import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json({ limit: '20mb' }));

const PROMPT = `You are a world-class jewelry appraiser and identification specialist with encyclopedic knowledge spanning antique hallmarking systems AND modern branded jewelry (Pandora, Tiffany, Cartier, David Yurman, Alex and Ani, Kendra Scott, Swarovski, etc.).

Carefully examine this jewelry image. Use ALL visual clues — brand logos, design language, clasp styles, bead shapes, charm styles, stone cuts, engravings, and any visible stamps — not just traditional hallmarks.

IMPORTANT CONTEXT FOR MODERN BRANDED JEWELRY:
- Pandora: Look for "ALE" mark + "S925" or "585" stamps (on bead barrels, clasp undersides, charm bails). Recognizable by their threaded charm bracelet system, Murano glass beads, and signature dangle charms. Most pieces are 925 sterling silver or 14k gold. Retail $30–$100 per charm; resale typically 30–50% of retail.
- Tiffany & Co: "T&CO 925" or "T&CO 750" stamps. Iconic blue box. Clean minimalist designs.
- Cartier: "Cartier" engraving + metal purity stamp. Love bracelets, Trinity rings, Juste un Clou.
- Alex and Ani: "ALEX AND ANI" + "RAFAELIAN SILVER/GOLD" stamps. Wire bangle style.
- Other brands: Identify by distinctive design patterns, logo stamps, or brand-specific construction methods.

Return ONLY a raw JSON object — no markdown fences, no prose, just valid JSON:

{
  "jewelryType": "Specific type (e.g. 'Pandora Charm Bracelet', 'Pandora Murano Glass Charm', 'Tiffany T-Bar Necklace', 'Sterling Silver Ring')",
  "description": "2-3 sentences: brand identification, specific product line or collection if recognizable, design elements, materials, condition",
  "hallmarkMeaning": "All visible stamps, hallmarks, or brand marks explained. If not visible, note exactly what to look for and where.",
  "estimatedEra": "For branded jewelry use release period. For vintage/antique use specific decade.",
  "metalContent": "Metal type and purity (e.g. '925 Sterling Silver', '14k Yellow Gold (585)', 'Pandora Rose — 18k rose gold-plated sterling silver'). Note if uncertain.",
  "estimatedValueRange": "Realistic resale / secondary market value in USD.",
  "authenticityTips": [
    "Most specific authentication tip for this exact piece",
    "Where to look for stamps/hallmarks on this type",
    "What fakes or lower-quality copies typically look like"
  ],
  "confidenceLevel": "High",
  "additionalNotes": "Care tips, collectibility notes, limited edition status, and any relevant caveats."
}

Set confidenceLevel to:
- "High"   — brand/hallmarks clearly identifiable
- "Medium" — likely identification based on design style but stamps not visible
- "Low"    — genuinely unclear, very poor image quality, or object is not jewelry`;

app.post('/analyze', async (req, res) => {
  const { base64, mimeType } = req.body;

  if (!base64 || !mimeType) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env file' });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    const text = response.choices[0].message.content.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Unexpected AI response format');

    return res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('[/analyze error]', err.message);
    return res.status(500).json({ error: err.message || 'Identification failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✦ HallmarkIQ server running at http://localhost:${PORT}`);
});
