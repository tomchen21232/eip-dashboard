
import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle, X, Info } from 'lucide-react';

interface PageHelpProps {
    title: string;
    description: string;
    metrics?: { label: string; desc: string }[];
    tips?: string[];
}

export const PageHelp: React.FC<PageHelpProps> = ({ title, description, metrics, tips }) => {
    const [isOpen, setIsOpen] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    return (
        <>
            <button 
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-full hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm"
            >
                <HelpCircle size={14} />
                <span>功能說明與術語</span>
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div ref={modalRef} className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in flex flex-col max-h-[85vh]">
                        <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <Info className="text-indigo-600" size={20} />
                                    {title}
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">BPR 顧問數據解讀手冊</p>
                            </div>
                            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1 rounded-full transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto space-y-6">
                            <div>
                                <h4 className="text-sm font-bold text-slate-700 mb-2">💡 功能概述</h4>
                                <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100 shadow-inner">
                                    {description}
                                </p>
                            </div>

                            {metrics && metrics.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-bold text-slate-700 mb-2">📊 指標與邏輯定義</h4>
                                    <div className="space-y-3">
                                        {metrics.map((m, idx) => (
                                            <div key={idx} className="bg-white border border-slate-100 p-3 rounded-lg shadow-sm">
                                                <span className="font-bold text-indigo-700 text-xs bg-indigo-50 px-2 py-0.5 rounded mb-1 inline-block">{m.label}</span>
                                                <p className="text-sm text-slate-600 leading-relaxed">{m.desc}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {tips && tips.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-bold text-slate-700 mb-2">🔍 數據解讀技巧</h4>
                                    <ul className="space-y-2">
                                        {tips.map((tip, idx) => (
                                            <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                                                <span className="text-indigo-400 mt-1">•</span>
                                                {tip}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                            <button onClick={() => setIsOpen(false)} className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-md">
                                確認瞭解
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
