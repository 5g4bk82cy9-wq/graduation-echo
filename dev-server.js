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
  const identityText = identity ? `\n隐藏身份：${identity}` : '';
  const systemPrompt = `你是一位大学记忆作家，擅长用细腻温暖的文字捕捉校园生活的闪光瞬间。

根据用户输入的一句话自画像，为ta写一段200-300字的第二人称回忆。

要求：
1. 基于自画像合理扩充，不虚构具体细节
2. 结尾附带一句善意的吐槽，让回忆温暖但不煽情
3. 引用一句真实存在的古今中外金句（诗词/歌词/台词均可），标注出处
4. 输出一个5字以内的"共鸣关键词"，概括这段回忆的核心情绪

请严格以 JSON 格式输出：
{
  "memory": "（200-300字的第二人称回忆正文）",
  "quote": "「金句原文」——出处",
  "roast": "（一句善意的吐槽）",
  "keyword": "（5字以内的共鸣关键词）"
}`;

  const raw = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `用户的自画像：${sentence}${identityText}` }
  ]);

  let result;
  try { result = JSON.parse(raw); }
  catch { result = { memory: raw, quote: '', roast: '', keyword: '青春' }; }

  return {
    status: 200,
    body: {
      memory: result.memory || '',
      quote: result.quote || '',
      roast: result.roast || '',
      keyword: (result.keyword || '青春').trim().slice(0, 5)
    }
  };
}

// POST /api/store
async function handleStore(body) {
  const { sentence, memory, keyword } = body;
  if (!sentence || !memory || !keyword) {
    return { status: 400, body: { error: '缺少必要字段' } };
  }
  const entry = { ...body, created_at: Date.now() };
  kvLpush(`keyword:${keyword}`, entry);
  stats.total++;
  return { status: 200, body: { success: true, total: stats.total } };
}

// GET /api/store
function handleStoreGet() {
  return { status: 200, body: { total: stats.total } };
}

// POST /api/match
async function handleMatch(body) {
  const { keyword, memory, sentence } = body;
  if (!keyword) return { status: 400, body: { error: '缺少共鸣关键词' } };

  const entries = kvLrange(`keyword:${keyword}`);
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

请写一段不超过80字的诗意"发现卡"，发现他们青春中的共鸣点。要求温暖、惊喜、不煽情。直接输出发现文字，不要标题。`;
      discovery = await callDeepSeek([
        { role: 'system', content: '你是一位细腻的共鸣诗人。直接输出发现文字，不要任何前缀。' },
        { role: 'user', content: prompt }
      ], 0.8);
    } catch {
      discovery = `在无数种可能中，有人和你有相似的注脚。「${other.sentence}」—— 同一段青春，不同的坐标，但你们都在相似的时刻，感受过相同的心跳。`;
    }
    return {
      status: 200,
      body: {
        type: 'resonance',
        content: discovery.replace(/^[\[【（(][^\]】）)]*[\]】）)]\s*/g, '').trim(),
        matchCount: count,
        totalCount: stats.total,
        matchedSentence: other.sentence
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

请写一段不超过100字的群像总结，捕捉这些年轻人共同的青春气息。温暖、有共鸣、不说教。直接输出总结文字，不要标题。`;
    summary = await callDeepSeek([
      { role: 'system', content: '你是一位细腻的人文观察者。直接输出总结文字，不要任何前缀。' },
      { role: 'user', content: prompt }
    ], 0.8);
  } catch {
    summary = `从不同人的故事里，我们看到了相似的青春模样。${samples.map(s => `"${s.sentence}"`).join('、')}——这些自画像都藏着同一种热烈和眷恋。`;
  }
  return {
    status: 200,
    body: {
      type: 'group',
      content: summary.replace(/^[\[【（(][^\]】）)]*[\]】）)]\s*/g, '').trim(),
      matchCount: count,
      totalCount: stats.total
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
