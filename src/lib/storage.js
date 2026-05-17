import fs from 'fs/promises';
import path from 'path';

let statusCache = null; // In-memory cache
let cacheWriteTime = null;

function getStatusFilePath() {
  if (process.env.VERCEL) return '/tmp/line_status.json';
  return path.join(process.cwd(), 'data', 'status.json');
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try { await fs.mkdir(dir, { recursive: true }); } catch (err) {}
}

export async function getStatus() {
  // ถ้ามี cache >=10 วินาที รีเทิร์น cache เลย
  if (statusCache && cacheWriteTime && (Date.now() - cacheWriteTime < 10000)) {
    return statusCache;
  }
  try {
    const filePath = getStatusFilePath();
    const content = await fs.readFile(filePath, 'utf8');
    statusCache = JSON.parse(content);
    cacheWriteTime = Date.now();
    return statusCache;
  } catch {
    return { lastWebhookAt: null };
  }
}

export async function setLastWebhook(dateIsoString) {
  try {
    const filePath = getStatusFilePath();
    await ensureDir(filePath);
    // ถ้าค่าเดียวกับ cache/ไฟล์ ข้ามการเขียน
    if (statusCache && statusCache.lastWebhookAt === dateIsoString) return true;
    const data = { lastWebhookAt: dateIsoString };
    await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
    statusCache = data;
    cacheWriteTime = Date.now();
    return true;
  } catch (err) { return false; }
}