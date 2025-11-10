import React, { useMemo, useEffect, useState } from "react";
import { initializeApp } from 'firebase/app';
import { type Auth, getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth'; // <-- 1. Fixed type-only import
import { type Firestore, getFirestore, collection, addDoc, serverTimestamp, setLogLevel } from 'firebase/firestore'; // <-- 1. Fixed type-only import

// QPaper Forge — single-file React + TypeScript app
// Premium glassmorphism UI, AI-generated question papers, PDF export, regenerate with limits
// Works with OpenRouter or Google Gemini APIs (client-side). For production, proxy through your backend.
// TailwindCSS is assumed available in your build. If not, replace className styles with your CSS.

// -------------- Firebase & API Key Setup --------------
let db: Firestore | undefined;
let auth: Auth | undefined;
let openRouterApiKey: string | undefined = "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"; // Default key

try {
  let firebaseConfig: any;
  
  // @ts-ignore
  if (typeof __firebase_config !== 'undefined') {
    // Priority 1: Use Canvas global variable
    // @ts-ignore
    firebaseConfig = JSON.parse(__firebase_config);
    console.log("Firebase Initialized from global config");
  
  } else if (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' && import.meta.env.VITE_FIREBASE_CONFIG) {
    // Priority 2: Use Vite .env.local variable (for local dev)
    // @ts-ignore
    firebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
    console.log("Firebase Initialized from import.meta.env");
  
  } else {
    // No config found
    console.warn("Firebase config is missing. No __firebase_config global or VITE_FIREBASE_CONFIG found. Search logging will be disabled.");
  }

  if (firebaseConfig) {
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    setLogLevel('debug'); // <-- 2. Fixed 'Debug' to 'debug'
  }
  
} catch (e) {
  console.error("Failed to initialize Firebase:", e);
}

try {
  // @ts-ignore
  if (typeof __openrouter_api_key !== 'undefined') {
    // Priority 1: Use Canvas global variable
    // @ts-ignore
    openRouterApiKey = __openrouter_api_key;
  }
  // @ts-ignore
  else if (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' && import.meta.env.VITE_OPENROUTER_API_KEY) {
    // Priority 2: Use Vite .env.local variable (for local dev)
     // @ts-ignore
    openRouterApiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  }
  // If neither, the default key will be used (as defined above)
} catch(e) {
  console.warn("Could not read API key from environment, using default.");
}


// -------------- Types --------------
type QuestionType = "mcq" | "short" | "long" | "numerical";

type Question = {
  id: string;
  type: QuestionType;
  text: string;
  options?: string[]; // for MCQ
  answer?: string;
  marks?: number;
  difficulty?: "easy" | "medium" | "hard";
};

type PaperJSON = {
  metadata: {
    board: string; // e.g., CBSE/State/ICSE/Generic
    grade: string; // e.g., Class 12
    subject: string; // e.g., Mathematics
    topic: string; // e.g., Integration
    timeLimitMinutes?: number;
    totalMarks?: number;
    language?: string; // e.g., English/Hindi
    version: string; // schema version
    seed?: number;
  };
  structure: {
    sections: Array<{
      title: string;
      instructions?: string;
      questions: Question[];
    }>;
  };
};

// -------------- Helpers --------------
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(n, b));

// 8. REMOVED unused 'uid' function

function wrapText(text: string, maxChars = 92): string[] { // <-- 9. REMOVED unused 'ctx' parameter
  // Simple word-wrap for PDF (monospace-ish assumption)
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

// Helper to load CDN scripts
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(script);
  });
}

// -------------- PDF (jsPDF) --------------
// Using dynamic import to avoid bundling if unused
async function exportToPDF(docTitle: string, paper: PaperJSON) {
  try {
    // Load jsPDF from CDN
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  } catch (e) {
    console.error(e);
    alert("Failed to load PDF library. Please try again.");
    return;
  }

  // @ts-ignore
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const marginX = 48;
  let y = 64;
  const width = doc.internal.pageSize.getWidth();
  const lineHeight = 18;

  // Header
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(18);
  doc.text(docTitle, marginX, y);
  y += 24;

  doc.setFontSize(11);
  doc.setFont("Helvetica", "normal");
  const metaLine = `Board: ${paper.metadata.board}  |  Grade: ${paper.metadata.grade}  |  Subject: ${paper.metadata.subject}`;
  doc.text(metaLine, marginX, y);
  y += 16;
  doc.text(`Topic: ${paper.metadata.topic}  |  Time: ${paper.metadata.timeLimitMinutes ?? "—"} min  |  Marks: ${paper.metadata.totalMarks ?? "—"}`, marginX, y);
  y += 24;

  const addPageIfNeeded = (needed: number) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + needed > pageHeight - 64) {
      doc.addPage();
      y = 64;
    }
  };

  // Sections & Questions
  paper.structure.sections.forEach((sec, si) => {
    addPageIfNeeded(40);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`${si + 1}. ${sec.title}`, marginX, y);
    y += 22;

    if (sec.instructions) {
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(11);
      const lines = wrapText(sec.instructions, 96); // <-- 9. REMOVED unused 'ctx'
      for (const ln of lines) {
        addPageIfNeeded(lineHeight);
        doc.text(ln, marginX, y);
        y += lineHeight;
      }
      y += 4;
    }

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(12);

    sec.questions.forEach((q, qi) => {
      const qLabel = `${si + 1}.${qi + 1}`;
      const header = `${qLabel}) [${q.type.toUpperCase()}${q.marks ? ` • ${q.marks} marks` : ""}${q.difficulty ? ` • ${q.difficulty}` : ""}]`;

      addPageIfNeeded(lineHeight * 2);
      doc.setFont("Helvetica", "bold");
      doc.text(header, marginX, y);
      y += lineHeight;

      doc.setFont("Helvetica", "normal");
      doc.setFontSize(12);

      const qLines = wrapText(q.text, 96); // <-- 9. REMOVED unused 'ctx'
      qLines.forEach((ln) => {
        addPageIfNeeded(lineHeight);
        doc.text(ln, marginX, y);
        y += lineHeight;
      });

      if (q.type === "mcq" && q.options?.length) {
        q.options.forEach((opt, idx) => {
          const optText = `${String.fromCharCode(65 + idx)}. ${opt}`;
          const oLines = wrapText(optText, 90); // <-- 9. REMOVED unused 'ctx'
          oLines.forEach((ln) => {
            addPageIfNeeded(lineHeight);
            doc.text(ln, marginX + 18, y);
            y += lineHeight;
          });
        });
      }

      y += 8;
    });

    y += 8;
  });

  // Footer
  const date = new Date().toLocaleString();
  const footer = `Generated by QPaper Forge • ${date}`;
  const textWidth = doc.getTextWidth(footer);
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(9);
  doc.text(footer, width - textWidth - marginX, pageHeight - 24);

  doc.save(`${docTitle.replace(/\s+/g, "_")}.pdf`);
}

// -------------- AI Calls --------------
// RENAMED this function from callOpenRouterJSON to callGenerateApi
async function callGenerateApi(params: {
  // REMOVED apiKey from parameters
  model: string;
  prompt: string;
  seed?: number;
}) {
  const { model, prompt, seed } = params;
  // CHANGED the URL to our new, relative backend API endpoint
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // REMOVED Authorization, Referer, and X-Title headers.
      // The backend will handle all secrets.
    },
    body: JSON.stringify({
      // We just pass the data our backend will need
      model,
      prompt,
      seed,
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`); // Updated error message
  const data = await res.json();
  // We assume our backend will pass the JSON from OpenRouter straight through
  const content: string = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as PaperJSON;
}

// REMOVED the callGeminiJSON function as it's no longer needed

// -------------- Prompt Builder --------------
function buildPrompt(input: FormState) {
  const {
    board,
    grade,
    subject,
    topic,
    timeLimitMinutes,
    totalMarks,
    language,
    difficulty,
    counts,
    extraInstructions,
  } = input;

  const schema = `Return JSON in this exact TypeScript shape:\n\n{
  "metadata": {
    "board": string,
    "grade": string,
    "subject": string,
    "topic": string,
    "timeLimitMinutes": number,
    "totalMarks": number,
    "language": string,
    "version": "1.0",
    "seed": number
  },
  "structure": {
    "sections": Array<{
      "title": string,
      "instructions"?: string,
      "questions": Array<{
        "id": string,
        "type": "mcq" | "short" | "long" | "numerical",
        "text": string,
        "options"?: string[],
        "answer"?: string,
        "marks"?: number,
        "difficulty"?: "easy" | "medium" | "hard"
      }>
    }>
  }
}`;

  const blueprint = `Generate a balanced question paper that matches Indian school patterns. Constraints:\n- Board: ${board}\n- Grade/Class: ${grade}\n- Subject: ${subject}\n- Topic/Unit: ${topic}\n- Overall difficulty: ${difficulty}\n- Time limit: ${timeLimitMinutes} minutes\n- Total marks: ${totalMarks}\n- Language: ${language}\n- Include sections grouped by type.\n- Number of questions per type: MCQ=${counts.mcq}, Short=${counts.short}, Long=${counts.long}, Numerical=${counts.numerical}.\n- MCQs must include 4 options.\n- Provide short, precise model answers (do not reveal in the main body if typical exam would not). You may include answers inline in the JSON but questions must be clean.\n- Use unique IDs for questions.\n- Avoid repetition and ensure syllabus-accurate content for ${subject} (${topic}).\n${extraInstructions ? `- Extra: ${extraInstructions}` : ""}\n\n${schema}\nReturn ONLY the JSON object.`;

  return blueprint;
}

// -------------- UI State --------------
type FormState = {
  board: string;
  grade: string;
  subject: string;
  topic: string;
  timeLimitMinutes: number;
  totalMarks: number;
  language: string;
  difficulty: "easy" | "medium" | "hard";
  counts: { mcq: number; short: number; long: number; numerical: number };
  extraInstructions?: string;
};

const defaultForm: FormState = {
  board: "CBSE",
  grade: "Class 12",
  subject: "Mathematics",
  topic: "Integration",
  timeLimitMinutes: 180,
  totalMarks: 100,
  language: "English",
  difficulty: "medium",
  counts: { mcq: 5, short: 6, long: 3, numerical: 6 },
  extraInstructions: "Follow recent exam blueprints; emphasize conceptual reasoning and application.",
};

// -------------- Main Component --------------
export default function App() {
  const [form, setForm] = useState<FormState>(defaultForm);
  // REMOVED provider, model, and geminiModel states
  
  // API key is now loaded from the global scope
  const apiKey: string = openRouterApiKey || "";

  const [paper, setPaper] = useState<PaperJSON | null>(null);
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1e9));
  const [regenLeft, setRegenLeft] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // One-time auth listener
  useEffect(() => {
    if (!auth) {
      console.warn("Firebase Auth is not available. Skipping auth.");
      setIsAuthReady(true); // Mark as "ready" so app can proceed
      return;
    }

    const authInstance = auth;

    // Set up the listener
    const unsubscribe = onAuthStateChanged(authInstance, (user) => {
      if (user) {
        setUserId(user.uid);
        console.log("Auth state changed: user signed in", user.uid);
      } else {
        setUserId(null);
        console.log("Auth state changed: user signed out");
      }
      setIsAuthReady(true); // Mark as ready once listener has run at least once
    });

    // Attempt sign-in if no user is currently signed in
    if (!authInstance.currentUser) {
      (async () => {
        try {
          // @ts-ignore
          if (typeof __initial_auth_token !== 'undefined') {
            // @ts-ignore
            await signInWithCustomToken(authInstance, __initial_auth_token);
            console.log("Signed in with custom token.");
          } else {
            await signInAnonymously(authInstance);
            console.log("Signed in anonymously.");
          }
        } catch (err) {
          console.error("Firebase sign-in failed:", err);
        }
      })();
    } else {
        // User is already signed in from a previous session
        setUserId(authInstance.currentUser.uid);
        setIsAuthReady(true);
    }

    return () => unsubscribe();
  }, []); // Empty dependency array, runs once


  const summary = useMemo(() => {
    if (!paper) return "";
    const qCount = paper.structure.sections.reduce((acc, s) => acc + s.questions.length, 0);
    return `${paper.metadata.subject} • ${paper.metadata.topic} • ${qCount} questions`;
  }, [paper]);

  const onChange = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleGenerate = async (isRegenerate = false) => {
    setBusy(true);
    setError(null);
    
    if (!apiKey) {
      setError("API Key is missing. Please set VITE_OPENROUTER_API_KEY in your .env.local file and restart the server.");
      setBusy(false);
      return;
    }

    // --- Add Search Log to Firestore ---
    // We do this *before* generation to log the attempt
    if (db && isAuthReady) { // Only log if Firebase is ready
      try {
        const logData = {
          ...form,
          counts: `mcq:${form.counts.mcq}, short:${form.counts.short}, long:${form.counts.long}, num:${form.counts.numerical}`,
          timestamp: serverTimestamp(),
          userId: userId || "anonymous",
          isRegen: isRegenerate,
          seed: isRegenerate ? "new_random" : seed,
        };
        
        // Use a generic path for public logs
        // @ts-ignore
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const logCollectionPath = `artifacts/${appId}/public/data/search_logs`;
        
        const docRef = await addDoc(collection(db, logCollectionPath), logData);
        console.log("Search log added with ID: ", docRef.id);
      } catch (e) {
        console.error("Error adding search log: ", e);
      }
    } else {
      console.warn("Firestore 'db' not initialized or auth not ready. Skipping search log.");
    }
    // --- End Logging ---

    try {
      const prompt = buildPrompt({ ...form, counts: {
        mcq: clamp(form.counts.mcq, 0, 50),
        short: clamp(form.counts.short, 0, 50),
        long: clamp(form.counts.long, 0, 50),
        numerical: clamp(form.counts.numerical, 0, 50),
      } });

      let result: PaperJSON;
      const activeSeed = isRegenerate ? Math.floor(Math.random() * 1e9) : seed;
      // SIMPLIFIED: Always call our new API endpoint
      const modelToUse = "google/gemini-2.0-flash-thinking-exp";
      // UPDATED this function call to match the new name and parameters
      result = await callGenerateApi({ model: modelToUse, prompt, seed: activeSeed });

      // basic validation
      if (!result?.structure?.sections?.length) throw new Error("Model returned empty structure");

      // backfill metadata defaults
      result.metadata = {
        ...(result.metadata || {}), // <-- 3, 4, 5, 6, 7. MOVED spread to the top
        version: "1.0",
        seed: activeSeed,
        board: form.board,
        grade: form.grade,
        subject: form.subject,
        topic: form.topic,
        timeLimitMinutes: form.timeLimitMinutes,
        totalMarks: form.totalMarks,
        language: form.language,
      } as PaperJSON["metadata"];

      setPaper(result);
      if (isRegenerate) setRegenLeft((n) => clamp(n - 1, 0, 99));
      if (!isRegenerate) setSeed(activeSeed);
    } catch (e: any) {
      setError(e?.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!paper) return;
    await exportToPDF(`${paper.metadata.subject} ${paper.metadata.grade} — ${paper.metadata.topic}`, paper);
  };

  const handleDownloadJSON = () => {
    if (!paper) return;
    const blob = new Blob([JSON.stringify(paper, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qpaper_${paper.metadata.subject.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-100 selection:bg-white/20">
      {/* Shell */}
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Top Bar */}
        <div className="sticky top-0 z-20 mb-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-white/20 backdrop-blur" />
              <h1 className="text-xl font-semibold tracking-tight">QPaper Forge</h1>
            </div>
            <div className="text-sm opacity-80">
              {paper ? (
                <span className="">{summary}</span>
              ) : (
                <span>AI Question Paper Generator</span>
              )}
            </div>
          </div>
          {/* tiny progress bar */}
          <div className="h-[3px] w-full bg-white/5">
            <div
              className="h-[3px] bg-white/70 transition-all"
              style={{ width: busy ? "100%" : "0%" }}
            />
          </div>
        </div>

        {/* Content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Form */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader title="Exam Details" subtitle="Fill the blueprint" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Board">
                  <input className="inp" value={form.board} onChange={(e) => onChange("board", e.target.value)} />
                </Field>
                <Field label="Class/Grade">
                  <input className="inp" value={form.grade} onChange={(e) => onChange("grade", e.target.value)} />
                </Field>
                <Field label="Subject">
                  <input className="inp" value={form.subject} onChange={(e) => onChange("subject", e.target.value)} />
                </Field>
                <Field label="Topic/Unit">
                  <input className="inp" value={form.topic} onChange={(e) => onChange("topic", e.target.value)} />
                </Field>
                <Field label="Time (min)">
                  <input type="number" className="inp" value={form.timeLimitMinutes} onChange={(e) => onChange("timeLimitMinutes", Number(e.target.value))} />
                </Field>
                <Field label="Total Marks">
                  <input type="number" className="inp" value={form.totalMarks} onChange={(e) => onChange("totalMarks", Number(e.target.value))} />
                </Field>
                <Field label="Language">
                  <select className="inp" value={form.language} onChange={(e) => onChange("language", e.target.value)}>
                    <option>English</option>
                    <option>Hindi</option>
                  </select>
                </Field>
                <Field label="Difficulty">
                  <select className="inp" value={form.difficulty} onChange={(e) => onChange("difficulty", e.target.value as any)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-4 gap-3 mt-3">
                <Field label="MCQ">
                  <input type="number" className="inp" value={form.counts.mcq} onChange={(e) => setForm((f) => ({ ...f, counts: { ...f.counts, mcq: Number(e.target.value) } }))} />
                </Field>
                <Field label="Short">
                  <input type="number" className="inp" value={form.counts.short} onChange={(e) => setForm((f) => ({ ...f, counts: { ...f.counts, short: Number(e.target.value) } }))} />
                </Field>
                <Field label="Long">
                  <input type="number" className="inp" value={form.counts.long} onChange={(e) => setForm((f) => ({ ...f, counts: { ...f.counts, long: Number(e.target.value) } }))} />
                </Field>
                <Field label="Numerical">
                  <input type="number" className="inp" value={form.counts.numerical} onChange={(e) => setForm((f) => ({ ...f, counts: { ...f.counts, numerical: Number(e.target.value) } }))} />
                </Field>
              </div>
              <Field label="Extra Instructions" className="mt-3">
                <textarea className="inp min-h-20" value={form.extraInstructions} onChange={(e) => onChange("extraInstructions", e.target.value)} placeholder="Blueprint notes, sectioning rules, etc." />
              </Field>
              
              {/* --- MOVED CONTROLS --- */}
              <Field label="Seed" className="mt-3">
                <input type="number" className="inp" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </Field>
              <div className="flex gap-3 mt-4">
                <button className="btn" onClick={() => handleGenerate(false)} disabled={busy || !isAuthReady}>
                  {busy ? "Generating…" : (isAuthReady ? "Generate" : "Connecting...")}
                </button>
                <button className="btn ghost" onClick={() => handleGenerate(true)} disabled={busy || regenLeft <= 0 || !isAuthReady}>
                  Regenerate ({regenLeft})
                </button>
              </div>
              {error && <p className="mt-3 text-red-300 text-sm">{error}</p>}
              {/* --- END MOVED CONTROLS --- */}
            </Card>

            {/* REMOVED the entire "AI Provider" Card */}

            <Card>
              <CardHeader title="Export" subtitle="Download your paper" />
              <div className="flex gap-3">
                <button className="btn" onClick={handleDownloadPDF} disabled={!paper}>Download PDF</button>
                <button className="btn ghost" onClick={handleDownloadJSON} disabled={!paper}>Download JSON</button>
              </div>
              <p className="text-xs opacity-70 mt-2">Tip: Share JSON with your team, or convert to Word/LaTeX server-side later.</p>
            </Card>
          </div>

          {/* Right: Preview */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader title="Preview" subtitle={paper ? "Draft view (not WYSIWYG)" : "Nothing generated yet"} />
              {paper ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold">{paper.metadata.subject} — {paper.metadata.topic}</h3>
                    <p className="text-sm opacity-80">{paper.metadata.board} • {paper.metadata.grade} • Time: {paper.metadata.timeLimitMinutes} min • Marks: {paper.metadata.totalMarks} • Lang: {paper.metadata.language}</p>
                  </div>

                  {paper.structure.sections.map((sec, si) => (
                    <div key={si} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <h4 className="font-semibold mb-1">{si + 1}. {sec.title}</h4>
                      {sec.instructions && (
                        <p className="text-sm opacity-80 mb-2 italic">{sec.instructions}</p>
                      )}
                      <ol className="space-y-3">
                        {sec.questions.map((q, qi) => (
                          <li key={q.id || qi} className="leading-relaxed ml-4">
                            <strong className="mr-1">{qi + 1}.</strong>
                            <div className="text-sm opacity-70 mb-1 inline-block ml-1">[{q.type.toUpperCase()}{q.marks ? ` • ${q.marks}m` : ""}{q.difficulty ? ` • ${q.difficulty}` : ""}]</div>
                            <div className="whitespace-pre-wrap ml-6">{q.text}</div>
                            {q.type === "mcq" && q.options?.length ? (
                              <ul className="mt-2 space-y-1 ml-10 list-none">
                                {q.options.map((opt, oi) => (
                                  <li key={oi} className="flex items-center">
                                    <span className="mr-2 opacity-80">{String.fromCharCode(65 + oi)}.</span>
                                    <span>{opt}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm opacity-70">Fill the form and hit Generate. Your draft appears here.</div>
              )}
            </Card>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs opacity-60">© {new Date().getFullYear()} QPaper Forge • Built with React + TypeScript</div>
      </div>

      {/* Styles for glass + controls */}
      <style>{`
        .inp { @apply w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 outline-none focus:ring-2 focus:ring-white/30 backdrop-blur placeholder:opacity-70; }
        .btn { @apply rounded-xl px-4 py-2 bg-white/80 text-slate-900 font-medium shadow hover:bg-white active:translate-y-px transition disabled:opacity-50 disabled:cursor-not-allowed; }
        .btn.ghost { @apply bg-white/10 text-white border border-white/15 hover:bg-white/15; }
      `}</style>
    </div>
  );
}

// -------------- UI Primitives --------------
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-2xl p-5 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <div className="text-sm uppercase tracking-wider opacity-70">{subtitle}</div>
      <h2 className="text-lg font-semibold -mt-1">{title}</h2>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1 text-xs opacity-70">{label}</div>
      {children}
    </label>
  );
}