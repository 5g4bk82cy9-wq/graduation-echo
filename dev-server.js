/**
 * 本地开发服务器 - 模拟 Vercel Serverless 环境
 * 运行: node dev-server.js
 * 需要设置环境变量: export DEEPSEEK_API_KEY=your_key_here
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';

// ===== 内存存储（模拟 Vercel KV） =====
const store = new Map();
const stats = { total: 0 };

function kvLpush(key, val) {
  if (!store.has(key)) store.set(key, []);
  store.get(key).push(val);
}

function kvLrange(key) {
  return store.get(key) || [];
}

// ===== DeepSeek 调用 =====
async function callDeepSeek(messages, temperature = 0.8) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('请设置环境变量 DEEPSEEK_API_KEY');
  }
  const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    })
  });
  if (!resp.ok) throw new Error(`DeepSeek error: ${resp.status}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// ===== API 处理函数 =====

// POST /api/chat
async function handleChat(body) {
  const { sentence, identity } = body;
  if (!sentence || !sentence.trim()) {
    return { status: 400, body: { error: '请输入你的一句话回忆' } };
  }
  const identityText = identity ? `\nta形容自己是「${identity}」。` : '';
    const systemPrompt = `用户发来一段关于大学四年的自画像。你的任务是理解ta这句话背后的情绪核心，然后：

1. 先找一句真实存在的金句作为开场，可以是原著段落、电影台词、歌词等，必须真实存在，用「」引号括起来并标注出处。
2. 然后用第二人称写一段回应（100-180字），稳稳接住ta的感受。语气可以是朋友共情、长者宽慰、行人见证等不同角度，自然不生硬，像是一个真实的人在说话。

再加一句善意的吐槽，温暖不煽情。
为系统生成若干个索引关键词（内部使用，不展示给用户），用于匹配有相似感受的人。每15字生成1个，最多5个。每个不超过5个字。

请严格以 JSON 格式输出，不要输出任何其他内容：
{
  "quote": "「金句原文」——出处",
  "memory": "（第二人称回应，100-180字）",
  "roast": "（一句善意的吐槽）",
  "keywords": ["关键词1", "关键词2"]
}`;

  const raw = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `ta说：${sentence}${identityText}` }
  ]);

  let result;
  try { result = JSON.parse(raw); }
  catch { result = { memory: raw, quote: '', roast: '', keywords: ['青春'] }; }

  return {
    status: 200,
    body: {
      memory: result.memory || '',
      quote: result.quote || '',
      roast: result.roast || '',
      keywords: (Array.isArray(result.keywords) ? result.keywords.slice(0, Math.min(Math.max(Math.ceil((sentence || '').length / 15), 1), 5)).map(k => (k || '').trim().slice(0, 5)).filter(Boolean) : ['青春'])
    }
  };
}

// POST /api/store
async function handleStore(body) {
  const { sentence, memory, keywords } = body;
  if (!sentence || !memory || !keywords) {
    return { status: 400, body: { error: '缺少必要字段' } };
  }
  const kwList = Array.isArray(keywords) ? keywords.slice(0, 5) : ['青春'];
  const entry = { ...body, keywords: kwList, created_at: Date.now() };
  for (const kw of kwList) {
    if (kw && kw.trim()) {
      kvLpush(`keyword:${kw.trim()}`, entry);
    }
  }
  stats.total++;
  return { status: 200, body: { success: true, total: stats.total } };
}

// GET /api/store
function handleStoreGet() {
  return { status: 200, body: { total: stats.total } };
}

// POST /api/match
async function handleMatch(body) {
  const { keywords, memory, sentence } = body;
  if (!keywords || !keywords.length) return { status: 400, body: { error: '缺少共鸣关键词' } };

  const currentMem = memory || '';
  const seen = new Set();
  const entries = [];
  for (const kw of keywords) {
    const items = kvLrange(`keyword:${kw}`);
    items.forEach(item => {
      const key = item.memory || Math.random().toString();
      if (key !== currentMem && !seen.has(key)) { seen.add(key); entries.push(item); }
    });
  }
  const count = entries.length;

  if (count === 0) {
    return {
      status: 200,
      body: {
        type: 'unique',
        content: `你的故事，是这世上独一份的篇章。没有人走过完全相同的路，这段关于「${sentence}」的记忆，只属于你。`,
        matchCount: 0,
        totalCount: stats.total
      }
    };
  }

  if (count <= 10) {
    const other = entries[Math.floor(Math.random() * entries.length)];
    let discovery;
    try {
      const prompt = `你是一位共鸣诗人。下面是两位毕业生的毕业回忆，请发现他们之间"遥远的相似性"。

回忆A：「${sentence}」→ ${memory}
回忆B：「${other.sentence}」→ ${other.memory}

请写一段不超过80字的诗意"发现卡"。要求：不要使用分类语言（不要写"你们都是""你们的共同点是""你们属于"等），不要标签化；只描述两个具体感受之间的回响；温暖、具体、诗意，不煽情。直接输出发现文字，不要标题。`;
      discovery = await callDeepSeek([
        { role: 'system', content: '你是一位细腻的共鸣诗人。直接输出发现文字，不要任何前缀。' },
        { role: 'user', content: prompt }
      ], 0.8);
    } catch {
      discovery = ['在无数种可能中，有人和你有相似的注脚。—— 同一段青春，不同的坐标，但你们都在相似的时刻，感受过相同的心跳。','有人用另一句话，说了同一件事。你们不在同一个坐标系里，但那阵风的温度是一样的。','这个园子里，有人在不同的角落，和你翻到了同一页书的同一行。','不是一模一样的故事，是故事里那一声叹息，让你认出了ta。','你以为只有你一个人记得的那个瞬间，有人在另一天，用另一种方式替你记住了。'][Math.floor(Math.random()*5)];
    }
    return {
      status: 200,
      body: {
        type: 'resonance',
        content: discovery.replace(/^[\[【（(][^\]】）)]*[\]】）)]\s*/g, '').trim(),
        matchCount: count,
        totalCount: stats.total,
        currentKeywords: keywords,
        people: entries.slice(0, 5).map(function(e) {
          var sig = (!e || e.signature_type === 'anonymous' || !e.signature_type) ? '匿名' : (e.signature_value || '匿名');
          return { signature: sig, keywords: Array.isArray(e.keywords) ? e.keywords : ['青春'] };
        })
      }
    };
  }

  // > 10
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  const samples = shuffled.slice(0, 3);
  let summary;
  try {
    const prompt = `你是一位人文观察者。以下是几位毕业生的回忆片段，请总结他们的群像心声。

${samples.map((s, i) => `同学${i + 1}：「${s.sentence}」→ ${s.memory}`).join('\n')}

请写一段不超过100字的文字。要求：不要使用分类语言（不要写"他们都有""他们的共同点是"等），不要标签化；只描述感受之间的共鸣；温暖、有共鸣、不说教。直接输出总结文字，不要标题。`;
    summary = await callDeepSeek([
      { role: 'system', content: '你是一位细腻的人文观察者。直接输出总结文字，不要任何前缀。' },
      { role: 'user', content: prompt }
    ], 0.8);
  } catch {
    summary = ['在无数种可能中，有人和你有相似的注脚。—— 同一段青春，不同的坐标，但你们都在相似的时刻，感受过相同的心跳。','有人用另一句话，说了同一件事。你们不在同一个坐标系里，但那阵风的温度是一样的。','这个园子里，有人在不同的角落，和你翻到了同一页书的同一行。','不是一模一样的故事，是故事里那一声叹息，让你认出了ta。','你以为只有你一个人记得的那个瞬间，有人在另一天，用另一种方式替你记住了。'][Math.floor(Math.random()*5)];
  }
  return {
    status: 200,
    body: {
      type: 'group',
      content: summary.replace(/^[\[【（(][^\]】）)]*[\]】）)]\s*/g, '').trim(),
      matchCount: count,
      totalCount: stats.total,
      matchedKeyword: keywords,
      matchedSignatures: samples.map(s => { if (!s || s.signature_type === 'anonymous' || !s.signature_type) return '匿名'; return s.signature_value || '匿名'; })
    }
  };
}

// ===== MIME 类型 =====
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ===== HTTP 服务器 =====
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    // API 路由
    if (pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await handleChat(body);
      return sendJson(res, result.status, result.body);
    }

    if (pathname === '/api/store' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await handleStore(body);
      return sendJson(res, result.status, result.body);
    }

    if (pathname === '/api/store' && req.method === 'GET') {
      const result = handleStoreGet();
      return sendJson(res, result.status, result.body);
    }

    if (pathname === '/api/match' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await handleMatch(body);
      return sendJson(res, result.status, result.body);
    }

    // 静态文件
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // 回退到 index.html（SPA 支持）
      const indexPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        sendJson(res, 404, { error: 'Not Found' });
      }
    }
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: '服务器内部错误' });
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ===== 启动 =====
if (!process.env.DEEPSEEK_API_KEY) {
  console.warn('⚠️  未设置 DEEPSEEK_API_KEY，AI 生成功能将不可用');
  console.warn('   设置方式: export DEEPSEEK_API_KEY=你的密钥\n');
}

server.listen(PORT, () => {
  console.log(`🎓 毕业回响 · 本地开发服务器`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   退出: Ctrl+C\n`);
});
