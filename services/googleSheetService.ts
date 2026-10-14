
import { ProjectTask, ApprovalStatus } from '../types';

// Proxy Strategy Definition
// 定義多個備用 Proxy 來源（已移除失效與有 Origin 限制之 Private Key）
const PUBLIC_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`
];

// String Interning Cache
const stringCache = new Map<string, string>();
function intern(str: string): string {
  if (!str) return '';
  let cached = stringCache.get(str);
  if (!cached) {
    cached = str;
    stringCache.set(str, str);
  }
  return cached;
}

// Extract ID and GID
export const parseSheetInfo = (url: string) => {
    const trimmed = url.trim();
    const idMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    const id = idMatch ? idMatch[1] : null;
    const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : null; 
    return { id, gid };
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const validateCsvContent = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 10) {
        throw new Error("取得之資料為空或長度過短");
    }
    const lower = trimmed.slice(0, 300).toLowerCase();
    if (lower.startsWith('<!doctype html') || lower.startsWith('<html') || lower.includes('<head>') || lower.includes('google-signin')) {
        const privateErr = new Error("收到 Google 登入或錯誤網頁（請確認雲端檔案已開啟「知道連結的任何人均可查看」檢視權限）");
        (privateErr as any).isPrivate = true;
        throw privateErr;
    }
};

// Helper: Fetch text with multi-tier fallback (Local Proxy -> Direct Fetch -> Public Proxies)
const fetchTextWithFallback = async (targetUrl: string): Promise<string> => {
    // 加上快取破壞參數
    const urlWithTs = targetUrl.includes('?') 
        ? `${targetUrl}&_t=${Date.now()}` 
        : `${targetUrl}?_t=${Date.now()}`;

    let lastError: any = null;

    // 1. 優先嘗試本地應用服務端代理 (/api/sheet-proxy)
    // 具備極高速直接連線至 Google、完全無 CORS 阻擋、支援大流量串流，最穩定
    try {
        const localProxyUrl = `/api/sheet-proxy?url=${encodeURIComponent(urlWithTs)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45秒逾時 (處理16MB+巨量表單)
        const response = await fetch(localProxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const text = await response.text();
            validateCsvContent(text);
            return text;
        }
    } catch (e: any) {
        if (e.isPrivate) throw e;
        lastError = e;
    }

    // 2. 嘗試瀏覽器端直接連線 (Google Sheets GVIZ 具備天然 CORS 支援)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(urlWithTs, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const text = await response.text();
            validateCsvContent(text);
            return text;
        }
    } catch (e: any) {
        if (e.isPrivate) throw e;
        lastError = e;
    }

    // 3. 第三備援：外部公共 CORS 代理節點
    for (let i = 0; i < PUBLIC_PROXIES.length; i++) {
        const generateProxy = PUBLIC_PROXIES[i];
        try {
            const proxyUrl = generateProxy(urlWithTs);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.status === 403 || response.status === 429) {
                continue;
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            validateCsvContent(text);
            return text;
        } catch (e: any) {
            if (e.isPrivate) throw e;
            lastError = e;
        }
    }

    throw lastError || new Error("無法從所有通道讀取該檔案，請檢查網路連線或連結權限。");
};

export const fetchGoogleSheetData = async (
    urls: string[], 
    onProgress?: (msg: string) => void
): Promise<ProjectTask[]> => {
  let allTasks: ProjectTask[] = [];
  stringCache.clear();

  console.log(`Starting massive data fetch for ${urls.length} sources...`);
  const errorDetails: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const rawUrl = urls[i];
    if(!rawUrl.trim()) continue;

    const { id, gid } = parseSheetInfo(rawUrl);
    
    if (!id) {
        const msg = `第 ${i+1} 個連結無效或無法解析 ID: ${rawUrl.slice(0, 40)}...`;
        console.warn(msg);
        errorDetails.push(msg);
        continue;
    }

    try {
      if (onProgress) onProgress(`正在讀取檔案 ${i+1} / ${urls.length}...`);
      if (i > 0) await delay(100);

      // Strategy 1: Google Visualization API (GVIZ) Endpoint 優先，原生支援 CORS 且格式標準
      let gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
      if (gid) gvizUrl += `&gid=${gid}`;

      let text = "";
      try {
          text = await fetchTextWithFallback(gvizUrl);
      } catch (gvizError: any) {
          if (gvizError.isPrivate) throw gvizError;
          console.warn(`GVIZ endpoint failed for ${id}, trying export endpoint...`);
          // Strategy 2: Standard Export URL 備援
          let exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
          if (gid) exportUrl += `&gid=${gid}`;
          text = await fetchTextWithFallback(exportUrl);
      }
      
      const tasks = parseCSV(text);
      console.log(`Part ${i+1} (${id}) parsed: ${tasks.length} rows`);
      
      for (let j = 0; j < tasks.length; j++) {
        allTasks.push(tasks[j]);
      }

    } catch (error: any) {
      const errMsg = error.message || String(error);
      console.warn(`Error fetching sheet ID=${id}:`, errMsg);
      errorDetails.push(`檔案 ${i+1} (ID: ${id}): ${errMsg}`);
      if (onProgress) {
          onProgress(`檔案 ${i+1} 讀取受阻: ${errMsg.slice(0, 25)}，繼續讀取其餘檔案...`);
      }
    }
  }

  if (allTasks.length === 0 && errorDetails.length > 0) {
      const formatted = errorDetails.join('\n');
      throw new Error(`讀取完成但未成功解析到任何資料。\n詳細失敗原因如下：\n${formatted}`);
  }

  if (onProgress) {
      const skippedCount = errorDetails.length;
      if (skippedCount > 0) {
          onProgress(`完成！成功載入 ${allTasks.length} 筆資料 (共 ${urls.length} 份，其中 ${skippedCount} 份未取得)`);
      } else {
          onProgress(`全數完成！共載入 ${allTasks.length} 筆資料`);
      }
  }

  // Fill empty subjects from tasks of the same form
  const subjectMap = new Map<string, string>();
  for (const t of allTasks) {
     if (t.subject && !subjectMap.has(t.formId)) {
        subjectMap.set(t.formId, t.subject);
     }
  }
  for (const t of allTasks) {
     if (!t.subject) {
        const s = subjectMap.get(t.formId);
        if (s) t.subject = s;
     }
  }

  const expiredAccounts = new Set<string>();
  const nowTime = new Date();
  
  for (const t of allTasks) {
      if (t.approverExpiryDate && t.approverExpiryDate.trim() !== '') {
          const dateStr = t.approverExpiryDate.trim();
          if (!dateStr.includes('9999/12/31') && !dateStr.includes('9999-12-31') && !dateStr.includes('9999')) {
              const expDate = new Date(dateStr);
              if (!isNaN(expDate.getTime()) && expDate < nowTime) {
                  if (t.currentApproverAccount) {
                      expiredAccounts.add(t.currentApproverAccount);
                  }
              }
          }
      }
  }

  for (const t of allTasks) {
      if (t.applicantAccount && expiredAccounts.has(t.applicantAccount) && t.applicantName && t.applicantName.trim() !== '' && t.applicantName.trim() !== '-') {
          if (!t.applicantName.includes('(離職)')) {
              t.applicantName = `${t.applicantName.trim()}(離職)`;
          }
      }
      if (t.currentApproverAccount && expiredAccounts.has(t.currentApproverAccount) && t.currentApprover && t.currentApprover.trim() !== '' && t.currentApprover.trim() !== '-') {
          if (!t.currentApprover.includes('(離職)')) {
              t.currentApprover = `${t.currentApprover.trim()}(離職)`;
          }
      }
  }

  return allTasks;
};

function mapApprovalStatus(text: string): ApprovalStatus {
  const t = text.trim();
  if (t.includes('退回申請者')) return ApprovalStatus.RETURNED;
  if (t.includes('否決') || t.includes('退簽') || t.includes('退件') || t.includes('退回')) return ApprovalStatus.REJECTED;
  if (t.includes('同意') || t.includes('核准') || t.includes('完成') || t.includes('結案')) return ApprovalStatus.APPROVED;
  if (t.includes('作廢') || t.includes('撤銷') || t.includes('取消')) return ApprovalStatus.CANCELLED;
  return ApprovalStatus.PENDING; 
}

const now = new Date();

function parseCSV(text: string): ProjectTask[] {
  const tasks: ProjectTask[] = [];
  
  let rowStart = 0;
  let inQuote = false;
  let fieldStart = 0;
  let currentFields: string[] = [];
  
  let headers: string[] = [];
  let headerMap: Record<string, number> = {};
  
  const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const len = cleanText.length;

  for (let i = 0; i < len; i++) {
    const char = cleanText[i];
    
    if (char === '"') {
      inQuote = !inQuote;
    }
    
    if (!inQuote) {
        if (char === ',') {
            currentFields.push(parseField(cleanText, fieldStart, i));
            fieldStart = i + 1;
        } else if (char === '\r' || char === '\n') {
            currentFields.push(parseField(cleanText, fieldStart, i));
            processRow(currentFields, headers, headerMap, tasks);
            currentFields = [];
            if (char === '\r' && i + 1 < len && cleanText[i + 1] === '\n') {
                i++;
            }
            fieldStart = i + 1;
        }
    }
    
    if (i === len - 1 && fieldStart <= i) {
         if (char !== '\r' && char !== '\n') {
             currentFields.push(parseField(cleanText, fieldStart, i + 1));
             processRow(currentFields, headers, headerMap, tasks);
         }
    }
  }

  return tasks;
}

function parseField(text: string, start: number, end: number): string {
    let raw = text.substring(start, end);
    if (raw.length === 0) return "";
    
    // GVIZ API returns quotes around all strings, handle them carefully
    if (raw.startsWith('"') && raw.endsWith('"')) {
        raw = raw.slice(1, -1);
        if (raw.includes('""')) {
            raw = raw.replace(/""/g, '"');
        }
    }
    return raw;
}

function processRow(row: string[], headers: string[], headerMap: Record<string, number>, tasks: ProjectTask[]) {
    if (row.length === 0 || (row.length === 1 && row[0] === '')) return;

    if (headers.length === 0) {
        row.forEach((h, idx) => {
             const cleanH = h.trim().replace(/\s+/g, '');
             headers.push(cleanH);
             headerMap[cleanH] = idx;
        });
        return;
    }

    const getValue = (key: string) => {
        const idx = headerMap[key];
        return (idx !== undefined && idx < row.length) ? row[idx].trim() : '';
    };

    const formId = getValue('表單編號');
    if (!formId) return;

    const rawFormName = getValue('表單名稱');
    const systemName = getValue('系統名稱');
    const category = intern(rawFormName || systemName || '一般表單');

    const expiryStr = getValue('目前簽核者帳號到期日');
    
    let isAccountExpired = false;
    if (expiryStr) {
        const expDate = new Date(expiryStr);
        if (!isNaN(expDate.getTime()) && expDate < now) {
            isAccountExpired = true;
        }
    }

    const durationStr = getValue('停留時間(總秒數)');
    const durationSeconds = durationStr ? parseInt(durationStr.replace(/,/g, '')) || 0 : 0;

    tasks.push({
      formId,
      formName: category,
      applyMonth: intern(getValue('申請年月')),
      applyTime: getValue('申請時間'),
      applicantName: getValue('申請者名稱'),
      applicantTitle: getValue('申請者職級名稱') || getValue('申請者職稱'),
      applicantAccount: getValue('EIP員工帳號'),
      applicantDept: intern(getValue('申請者部門名稱')),
      subject: getValue('需求主旨') || getValue('表單主旨') || getValue('主旨') || getValue('需求主旨/原表單號') || getValue('需求主旨/原單號') || '',
      currentApprover: intern(getValue('目前簽核者名稱')),
      currentApproverAccount: getValue('目前簽核者帳號'),
      currentApproverDept: intern(getValue('目前簽核者部門')),
      approverExpiryDate: expiryStr,
      isAccountExpired,
      stepStartTime: getValue('該站點表單簽核開始時間'),
      stepEndTime: getValue('該站點表單簽核結束時間') || null,
      durationDisplay: getValue('停留時間(天:小時:分鐘)'),
      approvalComment: getValue('簽核意見'),
      approvalStatus: mapApprovalStatus(getValue('表單中各個關卡簽核狀態') || getValue('簽核狀態')),
      rawStepStatus: getValue('表單中各個關卡簽核狀態') || getValue('簽核狀態'),
      mainStatus: intern(getValue('主要表單工作狀態')),
      durationSeconds,
    });
}
