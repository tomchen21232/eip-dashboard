// AI 功能已自網頁版停用：前端無法安全保存 Gemini API Key（打包後任何人都看得到）。
// 若日後要恢復，請改由後端代理（例如 Cloudflare Worker / Apps Script）呼叫 Gemini API，
// 並只把下列函式的內容換成呼叫該代理即可，元件端不需修改。

const DISABLED = "AI 功能未啟用（網頁版）";

export interface InnovationDeptAiResult {
  managerAdvice: string[];
  kpiArguments: string[];
  performanceSummary: string;
}

export const generateTaskSummary = async (_taskLogs: unknown[]): Promise<string> => DISABLED;
export const generatePersonSummary = async (_personName: string, _tasks: any[]): Promise<string> => DISABLED;
export const generateSingleFormInstanceSummary = async (_formId: string, _tasks: any[]): Promise<string> => DISABLED;
export const generateFormSummary = async (_formName: string, _tasks: any[]): Promise<string> => DISABLED;

export const analyzeInnovationDept = async (
  _stats: any,
  _customInstruction?: string,
  _targetDept: string = '創新整合部'
): Promise<InnovationDeptAiResult> => ({
  managerAdvice: [DISABLED],
  kpiArguments: [DISABLED],
  performanceSummary: DISABLED,
});
