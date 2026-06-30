import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // GET: 查询统计数据
  if (req.method === 'GET') {
    try {
      const total = await kv.get('stats:total');
      return res.status(200).json({ total: total || 0 });
    } catch {
      return res.status(200).json({ total: 0 });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const { sentence, identity, memory, quote, roast, keywords, signature_type, signature_value } = req.body;

  if (!sentence || !memory || !keywords) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  try {
    const kwList = Array.isArray(keywords) ? keywords.slice(0, 5) : ['青春'];
    const entry = {
      sentence,
      identity: identity || '',
      memory,
      quote: quote || '',
      roast: roast || '',
      keywords: kwList,
      signature_type: signature_type || 'anonymous',
      signature_value: signature_value || '',
      created_at: Date.now()
    };

    for (const kw of kwList) {
      if (kw && kw.trim()) {
        await kv.lpush(`keyword:${kw.trim()}`, JSON.stringify(entry));
      }
    }
    await kv.incr('stats:total');
    const total = await kv.get('stats:total');

    res.json({ success: true, total: total || 0 });
  } catch (err) {
    console.error('store error:', err);
    res.json({ success: true, total: 0, note: '存储暂不可用' });
  }
}
