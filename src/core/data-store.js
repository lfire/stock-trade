// 静态分片加载。只看历史，无实时端点；manifest 是数据契约入口。
// 串行 + 重试：避免简单静态服务器（单线程 http.server）在并发请求下偶发 Failed to fetch。
/** base 必须显式提供；也可完全跳过 fetch，改用 <stock-chart>.setDataset() 注入内存数据 */
export async function loadDataset(base) {
  if (!base) throw new Error('loadDataset(base)：需显式提供数据目录，或改用 setDataset() 注入数据');
  const get = async (file) => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(`${base}/${file}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    throw lastErr;
  };

  const manifest = await get('manifest.json');
  // manifest.files 驱动：分片集合不再硬编码，缺失的分片自动跳过，由 setDataset() 归一化兜底
  const result = { manifest };
  for (const [key, file] of Object.entries(manifest.files || {})) {
    if (typeof file === 'string') result[key] = await get(file);
  }
  return result;
}
