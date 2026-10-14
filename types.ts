
export interface ProjectTask {
  formId: string; // 表單編號
  // formName in this context now represents the "Category" or "Form Type" (formerly System)
  formName: string; 
  applyMonth: string; // 申請年月 (YYYY-MM)
  applyTime: string; // 申請時間
  applicantName: string; // 申請者名稱
  applicantTitle?: string; // 申請者職稱
  applicantAccount: string; // 申請者帳號 (EIP員工帳號)
  applicantDept: string; // 申請者部門名稱
  subject: string; // 需求主旨
  currentApprover: string; // 目前簽核者名稱
  currentApproverAccount: string; // 目前簽核者帳號
  currentApproverDept?: string; // 目前簽核者部門名稱
  approverExpiryDate?: string; // 目前簽核者帳號到期日
  isAccountExpired: boolean; // 帳號是否過期
  stepStartTime: string; // 該站點表單簽核開始時間
  stepEndTime: string | null; // 該站點表單簽核結束時間
  durationDisplay: string; // "停留時間(天:小時:分鐘)"
  approvalComment: string; // 簽核意見
  approvalStatus: ApprovalStatus; // 表單中各個關卡簽核狀態
  rawStepStatus?: string; // 原始各關卡簽核狀態
  mainStatus: string; // 主要表單工作狀態 (新增)
  durationSeconds: number; // 停留時間(總秒數)
  stayTimeSeconds?: number; // 該關卡實際停留秒數 (用於排序)
}

export enum ApprovalStatus {
  PENDING = '簽核中',
  APPROVED = '已核准',
  REJECTED = '不同意（否決）',
  CANCELLED = '作廢',
  RETURNED = '退回申請者'
}

export interface DashboardMetrics {
  totalTasks: number;
  avgDurationSeconds: number;
  pendingCount: number;
  delayedCount: number;
  expiredCount: number; // New KPI
  approvalRate: number;
}

export interface DepartmentStats {
  name: string;
  count: number;
  avgSeconds: number;
}

export interface AiAnalysisResult {
  summary: string;
  bottlenecks: string[];
  recommendations: string[];
}
