

import { ProjectTask, ApprovalStatus } from '../types';

const DEPARTMENTS = ['資訊部', '業務部', '人資部', '財務部', '行銷部', '營運部'];
// Renaming Categories to Form Names
const FORM_NAMES = ['請購單', '請假單', '加班申請單', '費用報銷單', '用印申請單', '合約審核單', '資訊需求單'];
const APPROVERS = ['陳小明', '林大華', '張美玲', '王建國', '李淑芬'];
const SUBJECTS = [
  '採購筆電五台',
  '2024 Q3 預算追加',
  '新進員工報到設定',
  '行銷活動費用請款',
  '伺服器維護合約',
  '機房進出申請',
  '供應商貨款支付'
];

function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}天:${h}時:${m}分`;
}

export const generateMockData = (count: number = 50): ProjectTask[] => {
  const data: ProjectTask[] = [];

  for (let i = 0; i < count; i++) {
    const isCompleted = Math.random() > 0.3;
    const startTime = randomDate(new Date(2023, 8, 1), new Date());
    const durationSec = Math.floor(Math.random() * (1209600 - 3600) + 3600); 
    const endTime = isCompleted ? new Date(startTime.getTime() + durationSec * 1000) : null;
    
    const currentDurationSec = isCompleted 
      ? durationSec 
      : Math.floor((new Date().getTime() - startTime.getTime()) / 1000);

    const statusRandom = Math.random();
    let status: ApprovalStatus = ApprovalStatus.PENDING;
    if (isCompleted) {
      if (statusRandom > 0.9) status = ApprovalStatus.CANCELLED;
      else if (statusRandom > 0.75) status = ApprovalStatus.REJECTED;
      else status = ApprovalStatus.APPROVED;
    }

    let mainStatus = '簽核中';
    if (status === ApprovalStatus.APPROVED) mainStatus = '結案';
    else if (status === ApprovalStatus.REJECTED) mainStatus = '退回';
    else if (status === ApprovalStatus.CANCELLED) mainStatus = '撤銷';

    // Mock Expiry
    const isExpired = Math.random() > 0.95;
    const expiryDate = isExpired 
        ? new Date(new Date().getTime() - 86400000 * Math.random() * 10).toISOString().split('T')[0]
        : '9999-12-31';

    const applicantId = Math.floor(Math.random() * 20) + 1;
    const approverIndex = Math.floor(Math.random() * APPROVERS.length);

    data.push({
      formId: `FORM-${20240000 + i}`,
      formName: FORM_NAMES[Math.floor(Math.random() * FORM_NAMES.length)], // This is the Category
      applyMonth: `${startTime.getFullYear()}-${(startTime.getMonth() + 1).toString().padStart(2, '0')}`,
      applyTime: startTime.toISOString(),
      applicantName: `使用者 ${applicantId}`,
      applicantAccount: `user${applicantId}`,
      applicantDept: DEPARTMENTS[Math.floor(Math.random() * DEPARTMENTS.length)],
      subject: SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)],
      currentApprover: isCompleted ? '-' : APPROVERS[approverIndex] + (isAccountExpired ? '(離職)' : ''),
      currentApproverAccount: isCompleted ? '-' : `approver${approverIndex + 1}` + (isAccountExpired ? '(離職)' : ''),
      currentApproverDept: DEPARTMENTS[Math.floor(Math.random() * DEPARTMENTS.length)],
      approverExpiryDate: expiryDate,
      isAccountExpired: isExpired && !isCompleted,
      stepStartTime: startTime.toISOString(),
      stepEndTime: endTime ? endTime.toISOString() : null,
      durationDisplay: formatDuration(currentDurationSec),
      approvalComment: isCompleted ? 'OK' : '',
      approvalStatus: status,
      mainStatus: mainStatus,
      durationSeconds: currentDurationSec
    });
  }

  return data;
};