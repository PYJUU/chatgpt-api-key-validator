import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, CheckCircle, XCircle, Loader2, Key, AlertCircle, Upload, FileText, Pause, Square } from 'lucide-react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

interface KeyResult {
  key: string;
  status: 'pending' | 'validating' | 'valid' | 'invalid' | 'error';
  models: string[];
  errorMsg?: string;
}

export default function App() {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<KeyResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const [concurrencyLimit, setConcurrencyLimit] = useState(1);
  const statusRef = useRef<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedInput = localStorage.getItem('chatgpt_validator_input');
    const savedResults = localStorage.getItem('chatgpt_validator_results');
    const savedConcurrency = localStorage.getItem('chatgpt_validator_concurrency');
    if (savedInput) setInput(savedInput);
    if (savedConcurrency) setConcurrencyLimit(parseInt(savedConcurrency, 10) || 1);
    if (savedResults) {
      try {
        const parsed = JSON.parse(savedResults);
        const sanitized = parsed.map((r: KeyResult) => 
          r.status === 'validating' ? { ...r, status: 'pending' } : r
        );
        setResults(sanitized);
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('chatgpt_validator_input', input);
  }, [input]);

  useEffect(() => {
    localStorage.setItem('chatgpt_validator_results', JSON.stringify(results));
  }, [results]);

  useEffect(() => {
    localStorage.setItem('chatgpt_validator_concurrency', concurrencyLimit.toString());
  }, [concurrencyLimit]);

  const updateStatus = (newStatus: 'idle' | 'running' | 'paused' | 'stopped') => {
    statusRef.current = newStatus;
    setStatus(newStatus === 'stopped' ? 'idle' : newStatus);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    let text = '';

    try {
      if (extension === 'txt' || extension === 'csv') {
        text = await file.text();
      } else if (extension === 'xlsx' || extension === 'xls') {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        text = XLSX.utils.sheet_to_txt(worksheet);
      } else if (extension === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (extension === 'doc') {
        // Fallback for .doc: read as binary string and try to extract sk- keys
        const buffer = await file.arrayBuffer();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        text = decoder.decode(buffer);
      } else {
        alert('不支持的文件格式，请上传 txt, csv, docx, doc, xlsx 或 xls 文件');
        event.target.value = '';
        return;
      }

      // Extract keys
      const lines = text.split(/\r?\n/);
      const keys: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        // Look for anything that looks like an OpenAI key
        const match = trimmed.match(/(sk-[a-zA-Z0-9_-]+)/);
        if (match) {
          keys.push(match[1]);
        }
      }

      if (keys.length > 0) {
        // Remove duplicates from the newly imported keys
        const uniqueNewKeys = Array.from(new Set(keys));
        setInput(prev => {
          const existing = prev.trim();
          return existing ? `${existing}\n${uniqueNewKeys.join('\n')}` : uniqueNewKeys.join('\n');
        });
      } else {
        alert('未在文件中找到有效的 API Key (需以 sk- 开头)');
      }
    } catch (error) {
      console.error('Error reading file:', error);
      alert('读取文件时出错，请检查文件格式是否正确');
    }
    
    // Reset file input
    event.target.value = '';
  };

  const handleValidate = async () => {
    if (status === 'paused') {
      updateStatus('running');
      return;
    }

    const keys = input.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    // Remove duplicates
    const uniqueKeys = Array.from(new Set(keys));
    if (uniqueKeys.length === 0) return;

    let currentResults = [...results];
    const existingKeys = currentResults.map(r => r.key);
    const keysMatch = uniqueKeys.length === existingKeys.length && uniqueKeys.every((k, i) => k === existingKeys[i]);
    
    if (!keysMatch) {
      currentResults = uniqueKeys.map(k => ({
        key: k,
        status: 'pending',
        models: []
      }));
      setResults(currentResults);
    }

    updateStatus('running');

    const queue = currentResults
      .map((r, idx) => ({ idx, status: r.status }))
      .filter(item => item.status === 'pending' || item.status === 'error')
      .map(item => item.idx);

    const CONCURRENCY = Math.max(1, Math.min(50, concurrencyLimit));

    const processNext = async () => {
      while (queue.length > 0) {
        if (statusRef.current === 'stopped') break;

        while (statusRef.current === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 200));
          if (statusRef.current === 'stopped') break;
        }

        if (statusRef.current === 'stopped') break;

        const i = queue.shift();
        if (i === undefined) break;

        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'validating' } : r));
        
        try {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${uniqueKeys[i]}`
            }
          });
          
          if (statusRef.current === 'stopped') {
             setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'pending' } : r));
             break;
          }

          if (response.ok) {
            const data = await response.json();
            const models = data.data
              .map((m: any) => m.id)
              .filter((m: string) => 
                m.startsWith('gpt-') || 
                m.startsWith('o1') || 
                m.startsWith('o3') || 
                m.startsWith('dall-e') || 
                m.startsWith('whisper') || 
                m.startsWith('tts') || 
                m.startsWith('text-embedding')
              );
            models.sort();
            
            setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'valid', models } : r));
          } else {
            let errorMsg = `HTTP ${response.status}`;
            try {
              const errData = await response.json();
              if (errData.error && errData.error.message) {
                errorMsg = errData.error.message;
              }
            } catch (e) {}
            setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'invalid', errorMsg } : r));
          }
        } catch (error: any) {
          setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', errorMsg: error.message } : r));
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    };

    const workers = [];
    const concurrency = Math.min(CONCURRENCY, queue.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);

    if (statusRef.current !== 'stopped') {
      updateStatus('idle');
    }
  };

  const handlePause = () => {
    updateStatus('paused');
  };

  const handleStop = () => {
    updateStatus('stopped');
    setResults(prev => prev.map(r => r.status === 'validating' ? { ...r, status: 'pending' } : r));
  };

  const handleClear = () => {
    if (status !== 'idle') return;
    if (window.confirm('确定要清除所有输入的 Key 和验证结果吗？')) {
      setInput('');
      setResults([]);
    }
  };

  const downloadValidKeys = () => {
    const validKeys = results.filter(r => r.status === 'valid').map(r => r.key).join('\n');
    downloadFile(validKeys, '可用key.txt');
  };

  const downloadValidKeysDetailed = () => {
    const content = results.filter(r => r.status === 'valid').map(r => {
      return `${r.key}\n${r.models.join(', ')}`;
    }).join('\n\n');
    downloadFile(content, '可用key(详情).txt');
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const maskKey = (key: string) => {
    if (key.length <= 10) return '***';
    return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center space-x-3 pb-4 border-b border-slate-200">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <Key size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ChatGPT API Key 验证工具</h1>
            <p className="text-sm text-slate-500">批量验证 OpenAI API Key 的有效性及可用模型</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-slate-700">
                  输入 API Keys (每行一个)
                </label>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleClear}
                    disabled={status !== 'idle' || (!input && results.length === 0)}
                    className="cursor-pointer inline-flex items-center justify-center text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 p-1.5 rounded-md transition-colors border border-slate-200 hover:border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="清除全部内容"
                    type="button"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 2l-9.5 9.5" />
                      <path d="M14.5 9.5c-2.5-2.5-6.5-2.5-9 0s-2.5 6.5 0 9c2.5 2.5 6.5 2.5 9 0s2.5-6.5 0-9z" />
                      <path d="M10 14l-4 4" />
                      <path d="M12 12l-4 4" />
                      <path d="M8 16l-4 4" />
                    </svg>
                  </button>
                  <input 
                    type="file" 
                    id="file-upload" 
                    className="hidden" 
                    accept=".txt,.csv,.xlsx,.xls,.docx,.doc"
                    onChange={handleFileUpload}
                    ref={fileInputRef}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status !== 'idle'}
                    className="cursor-pointer inline-flex items-center space-x-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-md transition-colors border border-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                  >
                    <Upload size={14} />
                    <span>导入文件</span>
                  </button>
                </div>
              </div>
              <textarea
                className="w-full h-64 p-3 text-sm font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none disabled:bg-slate-50 disabled:text-slate-500"
                placeholder="sk-...\nsk-..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={status !== 'idle'}
              />
              
              <div className="flex items-center space-x-3 mt-4">
                <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
                  并发数:
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={concurrencyLimit}
                  onChange={(e) => setConcurrencyLimit(parseInt(e.target.value) || 1)}
                  disabled={status !== 'idle'}
                  className="w-20 px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                />
                <span className="text-xs text-slate-500">推荐5并发</span>
              </div>
              
              {status === 'idle' ? (
                <button
                  onClick={handleValidate}
                  disabled={input.trim().length === 0}
                  className="mt-4 w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play size={18} />
                  <span>开始验证</span>
                </button>
              ) : (
                <div className="mt-4 flex space-x-2">
                  {status === 'running' ? (
                    <button
                      onClick={handlePause}
                      className="flex-1 flex items-center justify-center space-x-2 bg-amber-500 hover:bg-amber-600 text-white py-2.5 px-4 rounded-lg font-medium transition-colors"
                    >
                      <Pause size={18} />
                      <span>暂停</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleValidate}
                      className="flex-1 flex items-center justify-center space-x-2 bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 px-4 rounded-lg font-medium transition-colors"
                    >
                      <Play size={18} />
                      <span>继续</span>
                    </button>
                  )}
                  <button
                    onClick={handleStop}
                    className="flex-1 flex items-center justify-center space-x-2 bg-rose-500 hover:bg-rose-600 text-white py-2.5 px-4 rounded-lg font-medium transition-colors"
                  >
                    <Square size={18} />
                    <span>终止</span>
                  </button>
                </div>
              )}
            </div>

            {results.some(r => r.status === 'valid') && (
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
                <h3 className="text-sm font-medium text-slate-700">导出结果</h3>
                <button
                  onClick={downloadValidKeys}
                  className="w-full flex items-center justify-center space-x-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                >
                  <Download size={16} />
                  <span>下载 可用key.txt</span>
                </button>
                <button
                  onClick={downloadValidKeysDetailed}
                  className="w-full flex items-center justify-center space-x-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                >
                  <Download size={16} />
                  <span>下载 可用key（详情）.txt</span>
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full min-h-[400px]">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h2 className="text-sm font-medium text-slate-700">验证结果</h2>
                <div className="text-xs text-slate-500">
                  共 {results.length} 个 / 有效 {results.filter(r => r.status === 'valid').length} 个
                </div>
              </div>
              
              <div className="overflow-y-auto flex-1 p-0">
                {results.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8">
                    <FileText size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">暂无数据，请在左侧输入 Key 或导入文件并点击验证</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <th className="px-4 py-3 font-medium">API Key</th>
                        <th className="px-4 py-3 font-medium w-28">状态</th>
                        <th className="px-4 py-3 font-medium">可用模型 (摘要)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map((result, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">
                            {maskKey(result.key)}
                          </td>
                          <td className="px-4 py-3">
                            {result.status === 'pending' && <span className="inline-flex items-center text-xs text-slate-400"><Loader2 size={12} className="mr-1" /> 等待中</span>}
                            {result.status === 'validating' && <span className="inline-flex items-center text-xs text-indigo-500"><Loader2 size={12} className="mr-1 animate-spin" /> 验证中</span>}
                            {result.status === 'valid' && <span className="inline-flex items-center text-xs text-emerald-600"><CheckCircle size={12} className="mr-1" /> 有效</span>}
                            {(result.status === 'invalid' || result.status === 'error') && (
                              <span className="inline-flex items-center text-xs text-rose-500" title={result.errorMsg}>
                                <XCircle size={12} className="mr-1" /> 无效
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {result.status === 'valid' ? (
                              <div className="flex flex-wrap gap-1">
                                {result.models.filter(m => m.includes('gpt-4') || m.includes('gpt-3.5') || m.includes('o1') || m.includes('o3')).slice(0, 5).map(m => (
                                  <span key={m} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono border border-slate-200">
                                    {m}
                                  </span>
                                ))}
                                {result.models.length > 5 && (
                                  <span className="px-1.5 py-0.5 text-[10px] text-slate-400">
                                    +{result.models.length - 5} 更多
                                  </span>
                                )}
                              </div>
                            ) : result.errorMsg ? (
                              <span className="text-rose-400 truncate max-w-xs block" title={result.errorMsg}>
                                {result.errorMsg}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
