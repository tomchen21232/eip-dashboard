
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, Table as TableIcon, BrainCircuit, Menu, X, RefreshCw, Database, UserCheck, ChevronLeft, ChevronRight, Settings, Save, Link as LinkIcon, AlertCircle, Layers, Filter, BarChart3, Briefcase } from 'lucide-react';
import Dashboard from './components/Dashboard';
import DataTable from './components/DataTable';
import ApproverAnalysis from './components/ApproverAnalysis';
import ProcessFunnel from './components/ProcessFunnel';
import EfficiencyHeatmap from './components/EfficiencyHeatmap';
import InnovationDeptAnalysis from './components/InnovationDeptAnalysis';
import { fetchGoogleSheetData } from './services/googleSheetService';
import { ProjectTask } from './types';

// Update Version
const APP_VERSION = "v3.9.6 (新增部室專區篩選與獨立各表分析)";

// Default Data Sources
// 資料來源連結不寫在程式碼中（repo 為公開），首次使用請於「設定來源」貼上，會保存在本機瀏覽器。
const DEFAULT_URLS = '';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'data' | 'insights' | 'approver' | 'funnel' | 'heatmap' | 'innovation' | 'syseng' | 'dev'>('dashboard');
  const [data, setData] = useState<ProjectTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("準備中...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showErrorModal, setShowErrorModal] = useState(false); 
  
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const [sourceInput, setSourceInput] = useState(() => {
     // Updated Key to V9 to force load new defaults
     return localStorage.getItem('DATA_SOURCES_V9') || DEFAULT_URLS;
  });

  const isMounted = useRef(true);

  const uniqueFormCount = useMemo(() => {
      const forms = new Set(data.map(d => d.formId));
      return forms.size;
  }, [data]);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const loadData = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setErrorMsg(null);
    setShowErrorModal(false);
    setLoadingStatus("初始化...");
    setIsSettingsOpen(false); 
    
    const rawLinks = sourceInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    // Updated Key to V9
    localStorage.setItem('DATA_SOURCES_V9', sourceInput);

    if (rawLinks.length === 0) {
        const msg = "未設定任何資料來源連結。請點擊「設定來源」加入 Google Sheet 連結。";
        setErrorMsg(msg);
        setShowErrorModal(true);
        setData([]);
        setIsLoading(false);
        return;
    }

    try {
      setTimeout(async () => {
          try {
            const sheetData = await fetchGoogleSheetData(rawLinks, (msg) => {
                if(isMounted.current) setLoadingStatus(msg);
            });
            
            if (isMounted.current) {
                if (sheetData.length > 0) {
                    setData(sheetData);
                    setLastUpdated(new Date());
                    
                    setErrorMsg(null);
                    setShowErrorModal(false);
                } else {
                    setData([]);
                    const msg = "讀取完成，但沒有找到任何資料。可能是因為：\n1. 所有連結皆無效或格式錯誤\n2. 檔案權限未設為「知道連結者皆可檢視」\n3. 檔案分頁(GID)不正確";
                    setErrorMsg(msg);
                    setShowErrorModal(true);
                }
                setIsLoading(false);
            }
          } catch (e: any) {
             console.warn("Sheet data processing warning:", e);
             if(isMounted.current) {
                 const msg = `${e.message || "資料讀取失敗，請確認網路連線或共用權限。"}`;
                 setErrorMsg(msg);
                 setShowErrorModal(true);
                 setIsLoading(false);
             }
          }
      }, 100);
      
    } catch (error: any) {
      console.warn("Failed to load data:", error);
      if (isMounted.current) {
         setData([]);
         const msg = `資料讀取失敗：\n${error.message || "網路連線異常"}`;
         setErrorMsg(msg);
         setShowErrorModal(true);
         setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (sourceInput.trim()) {
      loadData();
    } else {
      setIsSettingsOpen(true);
    }
    const scheduleNextRefresh = () => {
        const now = new Date();
        const next9AM = new Date();
        next9AM.setHours(9, 0, 0, 0);
        if (now.getTime() > next9AM.getTime()) {
            next9AM.setDate(next9AM.getDate() + 1);
        }
        const timeToWait = next9AM.getTime() - now.getTime();
        return setTimeout(() => {
            loadData();
            setInterval(() => loadData(), 24 * 60 * 60 * 1000); 
        }, timeToWait);
    };
    const timerId = scheduleNextRefresh();
    return () => clearTimeout(timerId);
  }, []);

  const NavItem = ({ id, icon: Icon, label }: { id: typeof activeTab, icon: any, label: string }) => (
    <button
      type="button"
      onClick={() => { setActiveTab(id); setIsMobileSidebarOpen(false); }}
      title={isCollapsed ? label : ''}
      className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-start gap-3'} px-4 py-3 rounded-lg transition-all duration-200 ${
        activeTab === id ? 'bg-[#5D4037] text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon size={20} className="flex-shrink-0" />
      {!isCollapsed && <span className="font-medium whitespace-nowrap overflow-hidden transition-all duration-200 opacity-100">{label}</span>}
    </button>
  );

  return (
    <div className="h-screen flex bg-slate-50 text-slate-900 overflow-hidden">
      {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileSidebarOpen(false)} />}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 bg-white border-r border-slate-200 transform transition-[width,transform] duration-300 ease-in-out flex flex-col h-full ${isMobileSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'} ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}`}>
        <div className={`h-16 flex items-center border-b border-slate-100 flex-shrink-0 px-4 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center gap-3 overflow-hidden min-w-0">
            <div className="w-8 h-8 bg-[#5D4037] rounded-lg flex items-center justify-center text-white flex-shrink-0 shadow-sm"><LayoutDashboard size={18} /></div>
            {!isCollapsed && <h1 className="text-lg font-bold text-slate-800 tracking-tight whitespace-nowrap animate-fade-in truncate">星醫美學</h1>}
          </div>
          <div className="flex items-center">
            <button onClick={() => setIsCollapsed(!isCollapsed)} className="hidden lg:flex items-center justify-center p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all">
              {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
            <button onClick={() => setIsMobileSidebarOpen(false)} className="lg:hidden text-slate-500 hover:bg-slate-100 p-1 rounded-md transition-colors"><X size={24} /></button>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <NavItem id="dashboard" icon={LayoutDashboard} label="全表單儀表板" />
          
          <div className="pt-2 pb-1">
             {!isCollapsed && <div className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">深入分析</div>}
             <NavItem id="approver" icon={UserCheck} label="人員效率" />
             <NavItem id="funnel" icon={Filter} label="流程漏斗" />
             <NavItem id="heatmap" icon={BarChart3} label="效率熱圖" />
          </div>

          <div className="pt-2 pb-1 border-t border-slate-100">
             {!isCollapsed && <div className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">部室專區</div>}
             <NavItem id="innovation" icon={Briefcase} label="創新整合部分析" />
             <NavItem id="syseng" icon={Briefcase} label="系統工程部分析" />
             <NavItem id="dev" icon={Briefcase} label="程式開發部分析" />
          </div>

          <div className="pt-2 pb-1 border-t border-slate-100">
            {!isCollapsed && <div className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">資料與智慧</div>}
            <NavItem id="data" icon={TableIcon} label="資料列表" />
          </div>
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-4 flex-shrink-0 bg-white">
           <div className={`bg-slate-50 rounded-lg border border-slate-200 transition-all duration-300 overflow-hidden ${isCollapsed ? 'p-1' : 'p-4'}`}>
              {!isCollapsed && (
                <div className="mb-3 animate-fade-in space-y-2">
                  <div className="flex flex-col">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">總歷程資料 (Raw Rows)</p>
                    <div className="flex items-center gap-2">
                         <Database size={12} className="text-slate-500"/>
                         <span className="text-xs font-bold text-slate-700">{data.length.toLocaleString()} 筆</span>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">總表單數 (Unique Forms)</p>
                    <div className="flex items-center gap-2">
                         <Layers size={12} className="text-slate-500"/>
                         <span className="text-xs font-bold text-indigo-700">{uniqueFormCount.toLocaleString()} 單</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div className={`flex flex-col gap-2 ${isCollapsed ? 'mt-1' : 'mt-3'}`}>
                 <button 
                    onClick={() => setIsSettingsOpen(true)}
                    className={`w-full flex items-center justify-center gap-2 bg-slate-100 border border-slate-200 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors ${isCollapsed ? 'p-2' : 'px-3 py-2'}`}
                    title="設定資料來源"
                 >
                    <Settings size={14} />
                    {!isCollapsed && <span>設定來源</span>}
                 </button>

                 <button 
                    onClick={() => loadData()} 
                    disabled={isLoading} 
                    className={`w-full flex items-center justify-center gap-2 bg-indigo-600 border border-indigo-700 rounded-md text-xs font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 ${isCollapsed ? 'p-2' : 'px-3 py-2'}`}
                    title="重新整理"
                 >
                    <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                    {!isCollapsed && <span>讀取資料</span>}
                 </button>
              </div>
           </div>
           {!isCollapsed && <div className="text-center"><span className="text-[10px] text-slate-300 font-mono tracking-wider">Ver {APP_VERSION}</span></div>}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-50 relative">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0 z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileSidebarOpen(true)} className="lg:hidden text-slate-500"><Menu size={24} /></button>
            <h2 className="text-lg font-semibold text-slate-800">EIP 全表單管理中心</h2>
          </div>
          <div className="flex flex-col items-end">
             <div className="text-xs text-slate-400 font-mono mt-1">更新時間: {lastUpdated ? lastUpdated.toLocaleString('zh-TW', { hour12: false }) : '-'}</div>
             <div className="text-[10px] text-slate-300">資料來源: {sourceInput.split('\n').filter(s=>s.trim()).length} 個檔案</div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="w-full mx-auto pb-10 px-4 md:px-6 lg:px-8">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 animate-pulse">
                  <RefreshCw size={32} className="animate-spin mb-4 text-indigo-500" />
                  <p className="font-medium text-lg">{loadingStatus}</p>
                  <p className="text-sm mt-2 text-slate-400">正在處理百萬級大數據，請稍候...</p>
              </div>
            ) : errorMsg && data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-red-500 bg-red-50 rounded-xl border border-red-100 p-8">
                    <AlertCircle size={48} className="mb-4 text-red-400" />
                    <h3 className="text-lg font-bold mb-2">資料讀取異常</h3>
                    <p className="text-sm text-center max-w-md whitespace-pre-wrap">{errorMsg}</p>
                    <button 
                        onClick={() => setIsSettingsOpen(true)}
                        className="mt-6 px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
                    >
                        檢查連結設定
                    </button>
                </div>
            ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                    <Database size={48} className="mb-4 text-slate-300" />
                    <p>目前無資料顯示</p>
                    <button onClick={() => setIsSettingsOpen(true)} className="mt-4 text-indigo-600 hover:underline text-sm">設定資料來源</button>
                </div>
            ) : (
                <>
                    {activeTab === 'dashboard' && <Dashboard data={data} />}
                    {activeTab === 'innovation' && <InnovationDeptAnalysis key="innovation" data={data} targetDept="創新整合部" />}
                    {activeTab === 'syseng' && <InnovationDeptAnalysis key="syseng" data={data} targetDept="系統工程部" />}
                    {activeTab === 'dev' && <InnovationDeptAnalysis key="dev" data={data} targetDept="程式開發部" />}
                    {activeTab === 'approver' && <ApproverAnalysis data={data} />}
                    {activeTab === 'funnel' && <ProcessFunnel data={data} />}
                    {activeTab === 'heatmap' && <EfficiencyHeatmap data={data} />}
                    {activeTab === 'data' && <DataTable data={data} />}
                </>
            )}
          </div>
        </div>
      </main>

      {/* Error Alert Modal */}
      {showErrorModal && errorMsg && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
             <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col animate-scale-in border-t-4 border-red-500">
                <div className="p-5 border-b border-red-50 flex items-center gap-3 bg-red-50/50 rounded-t-xl">
                   <div className="p-2 bg-red-100 rounded-full text-red-600 flex-shrink-0">
                      <AlertCircle size={24} />
                   </div>
                   <div>
                       <h3 className="text-lg font-bold text-red-800">系統提示</h3>
                       <p className="text-xs text-red-600 mt-0.5">執行過程偵測到錯誤</p>
                   </div>
                </div>
                <div className="p-6 text-slate-700 text-sm leading-relaxed whitespace-pre-line max-h-[40vh] overflow-y-auto">
                   {errorMsg}
                </div>
                <div className="p-5 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end gap-3">
                    <button
                        onClick={() => { setShowErrorModal(false); setIsSettingsOpen(true); }}
                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 transition-colors"
                    >
                        設定來源
                    </button>
                    <button
                        onClick={() => setShowErrorModal(false)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm text-sm font-medium"
                    >
                        關閉視窗
                    </button>
                </div>
             </div>
          </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col animate-scale-in max-h-[90vh]">
              <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
                 <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Database className="text-indigo-600" /> 資料來源設定
                 </h3>
                 <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500"><X size={20} /></button>
              </div>
              
              <div className="p-6 overflow-y-auto">
                 <div className="mb-4 bg-blue-50 text-blue-800 p-4 rounded-lg text-sm border border-blue-100">
                     <p className="font-semibold mb-2 flex items-center gap-2"><LinkIcon size={16}/> 連結設定說明</p>
                     <p className="mb-1">請貼上 Google Sheet 完整網址。</p>
                     <p className="text-xs opacity-75 mt-1">⚠️ 確保網址包含 <code>gid=...</code> 若需要讀取特定分頁。</p>
                 </div>

                 <label className="block text-sm font-medium text-slate-700 mb-2">Google Sheets 連結列表 (一行一個)</label>
                 <textarea 
                     value={sourceInput}
                     onChange={(e) => setSourceInput(e.target.value)}
                     className="w-full h-64 p-4 border border-slate-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none leading-relaxed whitespace-pre bg-slate-50"
                     placeholder="https://docs.google.com/spreadsheets/d/..."
                 />
                 <div className="mt-2 text-xs text-slate-500 flex justify-between">
                     <span>目前設定來源數: {sourceInput.split('\n').filter(s => s.trim()).length}</span>
                     <span>連結僅保存在此瀏覽器，不會上傳</span>
                 </div>
              </div>

              <div className="p-5 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-end gap-3">
                  <button 
                      onClick={() => setIsSettingsOpen(false)}
                      className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
                  >
                      取消
                  </button>
                  <button 
                      onClick={loadData}
                      className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
                  >
                      <Save size={16} />
                      儲存並讀取
                  </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

export default App;
