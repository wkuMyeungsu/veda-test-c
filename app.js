'use strict';

// ============================================================
// 상수
// ============================================================

const CIRCLES = ['①', '②', '③', '④', '⑤'];
const TYPE_LABELS = { ox: 'O/X', multiple: '객관식', subjective: '주관식', short: '단답형' };
const SUBTYPE_LABELS = {
  code_blank:  '빈칸 채우기',
  code_result: '실행 결과 유추',
  concept:     '개념 서술'
};

// ============================================================
// 유틸
// ============================================================

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, n) {
  return shuffleArray(arr).slice(0, Math.min(n, arr.length));
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} `
       + `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// ============================================================
// 문제 로드 & 시험 구성
// ============================================================

async function loadBaseQuestions() {
  const noCache = { cache: 'no-store' };
  const mRes = await fetch('./questions/manifest.json', noCache);
  if (!mRes.ok) throw new Error('manifest.json을 찾을 수 없습니다.');
  const files = await mRes.json();
  const responses = await Promise.all(files.map(f => fetch(`./questions/${f}`, noCache)));
  responses.forEach((r, i) => { if (!r.ok) throw new Error(`${files[i]} 로드 실패`); });
  const arrays = await Promise.all(responses.map(r => r.json()));
  return arrays.flat();
}

async function loadAllQuestions() {
  const base       = await loadBaseQuestions();
  const deletedIds = loadDeletedIds();

  // 전체 오버라이드 적용 + 삭제 필터
  const processed = base
    .filter(q => !deletedIds.has(q.id))
    .map(q => { const ov = loadQFull(q.id); return ov ? { ...q, ...ov, id: q.id } : q; });

  // 사용자 추가 문제 병합
  const userQs   = loadUserQuestions().filter(q => !deletedIds.has(q.id));
  const combined = [...processed, ...userQs];

  return {
    ox:         combined.filter(q => q.type === 'ox'),
    multiple:   combined.filter(q => q.type === 'multiple'),
    subjective: combined.filter(q => q.type === 'subjective' || q.type === 'short')
  };
}

function buildExam(pools) {
  const ox         = pickRandom(pools.ox,         4);
  const multiple   = pickRandom(pools.multiple,   6);
  const subjective = pickRandom(pools.subjective, 10);
  return shuffleArray([...ox, ...multiple, ...subjective]);
}

// ============================================================
// sessionStorage
// ============================================================

function saveExamData(data) {
  sessionStorage.setItem('examData', JSON.stringify(data));
}

function loadExamData() {
  try { return JSON.parse(sessionStorage.getItem('examData')); }
  catch { return null; }
}

function clearExamData() {
  sessionStorage.removeItem('examData');
  sessionStorage.removeItem('examCurrentIndex');
  sessionStorage.removeItem('resultSaved');
}

// ============================================================
// 채점
// ============================================================

function scoreExam(examData) {
  const { questions, answers, overrides } = examData;
  let oxCorrect = 0, mcCorrect = 0, subCorrect = 0;

  const results = questions.map((q, i) => {
    let autoCorrect = null;
    if (q.type === 'ox') {
      autoCorrect = answers[i] !== undefined ? answers[i] === q.answer : false;
    } else if (q.type === 'multiple') {
      autoCorrect = answers[i] !== undefined ? answers[i] === q.answer : false;
    }
    // subjective: autoCorrect = null (반드시 override로 판정)

    const hasOverride = overrides[i] !== undefined;
    const finalCorrect = hasOverride ? overrides[i] : (autoCorrect ?? false);

    if (finalCorrect) {
      if (q.type === 'ox')         oxCorrect++;
      else if (q.type === 'multiple') mcCorrect++;
      else                            subCorrect++;
    }

    return {
      question: q,
      userAnswer: answers[i],
      autoCorrect,
      finalCorrect,
      wasOverridden: hasOverride,
      index: i
    };
  });

  const totalCorrect = oxCorrect + mcCorrect + subCorrect;
  const totalQ       = questions.length;
  const totalScore   = Math.round((totalCorrect / totalQ) * 100);
  const isChapterMode = examData.mode === 'chapter';
  // 챕터 연습: 60% 이상 정답, 일반 시험: 12문제 이상
  const pass = isChapterMode ? totalCorrect >= totalQ * 0.6 : totalCorrect >= 12;

  return { results, oxCorrect, mcCorrect, subCorrect, totalCorrect, totalScore, pass, totalQ, isChapterMode };
}

// ============================================================
// 결과 파일 읽기 (File System Access API)
// ============================================================

function parseResultText(filename, text) {
  const roundM   = text.match(/\((\d+)회차\)/);
  const dateM    = text.match(/날짜:\s*(.+)/);
  const scoreM   = text.match(/총점:\s*(\d+)/);
  const passM    = text.match(/판정:\s*(PASS|FAIL)/);
  const correctM = text.match(/정답 문제:\s*(\d+)\s*\/\s*(\d+)/);
  if (!roundM) return null;
  const isChapter  = text.includes('챕터 연습');
  const chaptersM  = text.match(/선택 챕터:\s*(.+)/);
  const chapters   = chaptersM ? chaptersM[1].trim().split(/,\s*/) : [];
  return {
    round:        parseInt(roundM[1], 10),
    date:         dateM?.[1]?.trim()     || '',
    totalScore:   parseInt(scoreM?.[1]   || '0', 10),
    pass:         passM?.[1] === 'PASS',
    totalCorrect: parseInt(correctM?.[1] || '0', 10),
    totalQ:       parseInt(correctM?.[2] || (isChapter ? '0' : '20'), 10),
    mode:         isChapter ? 'chapter' : 'regular',
    chapters,
    text,
    filename
  };
}

async function readResultFiles() {
  const dir = await getResultsDir(false);
  if (!dir) return [];
  const out = [];
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.txt')) continue;
      try {
        const file   = await handle.getFile();
        const text   = await file.text();
        const parsed = parseResultText(name, text);
        if (parsed) out.push(parsed);
      } catch { /* skip */ }
    }
  } catch { return []; }
  return out.sort((a, b) => b.round - a.round);
}

// ============================================================
// File System Access API — results/ 폴더 자동 저장
// ============================================================

const IDB_NAME  = 'cppExamDB';
const IDB_STORE = 'settings';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveDirHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, 'resultsDir');
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function loadDirHandle() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('resultsDir');
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  } catch { return null; }
}

// 폴더 핸들 반환. 권한 없으면 재요청. prompt=true면 폴더 선택 팝업 표시.
async function getResultsDir(prompt = true) {
  if (!window.showDirectoryPicker) return null;  // 미지원 브라우저

  let handle = await loadDirHandle();
  if (handle) {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;
    const req = await handle.requestPermission({ mode: 'readwrite' });
    if (req === 'granted') return handle;
  }
  if (!prompt) return null;

  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveDirHandle(handle);
    return handle;
  } catch { return null; }  // 사용자가 취소
}

// 폴더 이름 반환 (UI 표시용). 권한 없으면 null.
async function getResultsFolderName() {
  const handle = await getResultsDir(false);
  return handle ? handle.name : null;
}

// results/ 폴더에 파일 쓰기
async function writeResultFile(filename, text) {
  const dir = await getResultsDir(true);
  if (!dir) return false;
  try {
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable   = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  } catch (e) {
    console.error('파일 저장 실패:', e);
    return false;
  }
}

// ============================================================
// 사용자 메모 & 문제 수정 (localStorage)
// ============================================================

function loadNotes(qId) {
  try { return JSON.parse(localStorage.getItem(`notes_${qId}`)) || []; }
  catch { return []; }
}
function saveNotes(qId, notes) { localStorage.setItem(`notes_${qId}`, JSON.stringify(notes)); }
function loadQEdit(qId)        { return localStorage.getItem(`qEdit_${qId}`) || null; }
function saveQEdit(qId, text)  { localStorage.setItem(`qEdit_${qId}`, text); }

// 사용자 추가 문제
function loadUserQuestions() {
  try { return JSON.parse(localStorage.getItem('userQuestions')) || []; }
  catch { return []; }
}
function saveUserQuestions(qs) { localStorage.setItem('userQuestions', JSON.stringify(qs)); }

// 삭제된 기본 문제 ID
function loadDeletedIds() {
  try { return new Set(JSON.parse(localStorage.getItem('deletedQIds')) || []); }
  catch { return new Set(); }
}
function addDeletedId(id) {
  const ids = JSON.parse(localStorage.getItem('deletedQIds') || '[]');
  if (!ids.includes(id)) { ids.push(id); localStorage.setItem('deletedQIds', JSON.stringify(ids)); }
}

// 즐겨찾기
// favoriteQuestions: { [id]: questionObject }
function loadFavoriteMap() {
  try { return JSON.parse(localStorage.getItem('favoriteQuestions')) || {}; }
  catch { return {}; }
}
function isFavorite(id) { return id in loadFavoriteMap(); }
// q: 현재 문제 객체 (시험 중에만 호출됨)
function toggleFavorite(id, q) {
  const map = loadFavoriteMap();
  if (id in map) {
    delete map[id];
  } else if (q) {
    map[id] = q;
  }
  localStorage.setItem('favoriteQuestions', JSON.stringify(map));
  return id in map;
}
function loadFavoriteQuestions() {
  return Object.values(loadFavoriteMap());
}

// 기본 문제 전체 필드 오버라이드
function loadQFull(id) {
  try { return JSON.parse(localStorage.getItem(`qFull_${id}`)) || null; }
  catch { return null; }
}
function saveQFull(id, q)  { localStorage.setItem(`qFull_${id}`, JSON.stringify(q)); }
function clearQFull(id)    { localStorage.removeItem(`qFull_${id}`); }

// ============================================================
// 챕터별 요약
// ============================================================

function buildChapterSummary(results) {
  const map = {};
  results.forEach(r => {
    const ch = r.question.chapter || '기타';
    if (!map[ch]) map[ch] = { total: 0, correct: 0 };
    map[ch].total++;
    if (r.finalCorrect) map[ch].correct++;
  });
  return map;
}

// ============================================================
// 결과 텍스트 생성
// ============================================================

function generateResultText(examData, scores, round) {
  const { results, oxCorrect, mcCorrect, subCorrect, totalCorrect, totalScore, pass, totalQ, isChapterMode } = scores;
  const now  = formatDateTime(new Date());
  const lines = [];

  const modeLabel = isChapterMode ? '챕터 연습' : '이론 시험';
  lines.push(`===== C/C++ ${modeLabel} 결과 (${round}회차) =====`);
  lines.push(`날짜: ${now}`);
  if (isChapterMode) {
    lines.push(`선택 챕터: ${(examData.chapters || []).join(', ')}`);
    lines.push(`총점: ${totalScore}%  |  판정: ${pass ? 'PASS ✔' : 'FAIL ✘'}  (합격 기준: 60% 이상)`);
  } else {
    lines.push(`총점: ${totalScore} / 100  |  판정: ${pass ? 'PASS ✔' : 'FAIL ✘'}  (합격 기준: 60점 / 12문제)`);
  }
  lines.push('');
  const oxTotal  = results.filter(r => r.question.type === 'ox').length;
  const mcTotal  = results.filter(r => r.question.type === 'multiple').length;
  const subTotal = results.filter(r => r.question.type === 'subjective' || r.question.type === 'short').length;
  lines.push(`[O/X]    ${oxCorrect}/${oxTotal} 정답`);
  lines.push(`[객관식]  ${mcCorrect}/${mcTotal} 정답`);
  lines.push(`[주관식]  ${subCorrect}/${subTotal} 정답`);
  lines.push(`정답 문제: ${totalCorrect} / ${totalQ}`);
  lines.push('');
  lines.push('--- 문제별 상세 ---');

  results.forEach((r, i) => {
    const q = r.question;
    const statusStr = r.finalCorrect
      ? (r.wasOverridden ? '맞음 (수동 오버라이드)' : '맞음')
      : (r.wasOverridden ? '틀림 (수동 오버라이드)' : '틀림');

    let myAns;
    if (q.type === 'ox') {
      myAns = r.userAnswer === true ? 'O' : r.userAnswer === false ? 'X' : '미응답';
    } else if (q.type === 'multiple') {
      myAns = r.userAnswer !== undefined
        ? `${CIRCLES[r.userAnswer]} ${q.options[r.userAnswer]}`
        : '미응답';
    } else {
      myAns = examData.answers[i] || '미응답';
    }

    let correctAns;
    if (q.type === 'ox') {
      correctAns = q.answer ? 'O (참)' : 'X (거짓)';
    } else if (q.type === 'multiple') {
      correctAns = `${CIRCLES[q.answer]} ${q.options[q.answer]}`;
    } else {
      correctAns = q.answer;
    }

    lines.push('');
    lines.push(`${i + 1}. [${TYPE_LABELS[q.type]}] ${statusStr}`);
    lines.push(`   Q. ${q.question}`);
    if (q.code) {
      lines.push('   코드:');
      q.code.split('\n').forEach(l => lines.push(`      ${l}`));
    }
    lines.push(`   내 답: ${myAns}`);
    lines.push(`   정답:  ${correctAns}`);
    if (q.explanation) lines.push(`   해설: ${q.explanation}`);
  });

  return lines.join('\n');
}

// ============================================================
// 회차 관리 (localStorage)
// ============================================================

function getNextRound() {
  return parseInt(localStorage.getItem('examRound') || '0', 10) + 1;
}

function useRound() {
  const r = getNextRound();
  localStorage.setItem('examRound', String(r));
  return r;
}

// ============================================================
// INDEX 페이지
// ============================================================

function initIndexPage() {
  const startBtn    = document.getElementById('btn-start');
  const viewBtn     = document.getElementById('btn-view-results');
  const errorEl     = document.getElementById('error-msg');
  const folderNameEl = document.getElementById('folder-name');
  const setFolderBtn = document.getElementById('btn-set-folder');

  async function refreshFolderDisplay() {
    if (!folderNameEl) return;
    const name = await getResultsFolderName();
    if (name) {
      folderNameEl.textContent = name;
      folderNameEl.className   = 'folder-name set';
    } else {
      folderNameEl.textContent = '미설정';
      folderNameEl.className   = 'folder-name not-set';
    }
  }
  refreshFolderDisplay();

  if (setFolderBtn) {
    setFolderBtn.addEventListener('click', async () => {
      const handle = await getResultsDir(true);
      if (handle) refreshFolderDisplay();
    });
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = '불러오는 중...';
    try {
      const pools     = await loadAllQuestions();
      const questions = buildExam(pools);
      clearExamData();
      saveExamData({
        questions,
        answers:   {},
        overrides: {},
        startTime: Date.now()
      });
      window.location.href = 'exam.html';
    } catch {
      startBtn.disabled = false;
      startBtn.textContent = '시험 시작';
      errorEl.textContent = '⚠ 문제 파일을 불러올 수 없습니다. VS Code Live Server 또는 python -m http.server 8000 으로 실행해주세요.';
      errorEl.style.display = 'block';
    }
  });

  viewBtn.addEventListener('click', () => {
    window.location.href = 'result.html';
  });
}

// ============================================================
// EXAM 페이지
// ============================================================

function initExamPage() {
  let examData    = loadExamData();
  const container = document.getElementById('exam-container');

  if (!examData || !examData.questions) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px">
        <p style="color:#C5221F;margin-bottom:16px">시험 데이터가 없습니다.</p>
        <a href="index.html" class="btn-primary" style="text-decoration:none;display:inline-block">처음으로 돌아가기</a>
      </div>`;
    return;
  }

  // 챕터 연습 모드 헤더 표시
  if (examData.mode === 'chapter') {
    const titleEl = document.getElementById('exam-title');
    if (titleEl) titleEl.textContent = '📚 챕터 연습';
  }

  let currentIndex = parseInt(sessionStorage.getItem('examCurrentIndex') || '0', 10);
  const total      = examData.questions.length;

  // 타이머
  const timerEl = document.getElementById('exam-timer');
  const startMs = (typeof examData.startTime === 'number')
    ? examData.startTime
    : (examData.startTime ? new Date(examData.startTime).getTime() : Date.now());

  let timerInterval = null;
  function updateTimer() {
    const elapsed = Math.floor((Date.now() - startMs) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const pad = n => String(n).padStart(2, '0');
    if (timerEl) timerEl.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);

  function save() {
    saveExamData(examData);
    sessionStorage.setItem('examCurrentIndex', String(currentIndex));
  }

  function isSubjective(q) {
    return q.type === 'subjective' || q.type === 'short';
  }

  function canGoNext(idx) {
    return isSubjective(examData.questions[idx])
      ? examData.overrides[idx] !== undefined
      : true;
  }

  function answerDisplay(q) {
    if (q.type === 'ox')       return q.answer ? 'O &nbsp;(참)' : 'X &nbsp;(거짓)';
    if (q.type === 'multiple') return `${CIRCLES[q.answer]} ${escapeHtml(q.options[q.answer])}`;
    return escapeHtml(q.answer);
  }

  function renderQ(idx) {
    const q      = examData.questions[idx];
    const isLast = idx === total - 1;
    const isSubj = isSubjective(q);
    const ov     = examData.overrides[idx];

    const displayQuestion = loadQEdit(q.id) || q.question;

    // 진행 바
    document.getElementById('progress-fill').style.width  = `${((idx + 1) / total) * 100}%`;
    document.getElementById('progress-text').textContent  = `${idx + 1} / ${total}`;

    // 답안 입력 HTML
    let inputHtml = '';
    if (q.type === 'ox') {
      const tSel = examData.answers[idx] === true;
      const fSel = examData.answers[idx] === false;
      inputHtml = `
        <div class="options-list">
          <div class="option-item ${tSel ? 'selected' : ''}" data-val="true">
            <span class="option-radio-dot"></span>
            <span class="option-text">O &nbsp; (참)</span>
          </div>
          <div class="option-item ${fSel ? 'selected' : ''}" data-val="false">
            <span class="option-radio-dot"></span>
            <span class="option-text">X &nbsp; (거짓)</span>
          </div>
        </div>`;
    } else if (q.type === 'multiple') {
      inputHtml = `<div class="options-list">` +
        q.options.map((opt, i) => {
          const sel = examData.answers[idx] === i;
          return `<div class="option-item ${sel ? 'selected' : ''}" data-val="${i}">
            <span class="option-radio-dot"></span>
            <span class="option-text">${CIRCLES[i]} ${escapeHtml(opt)}</span>
          </div>`;
        }).join('') + `</div>`;
    } else {
      const saved = escapeHtml(examData.answers[idx] || '');
      inputHtml = `
        <div class="subtype-badge">${SUBTYPE_LABELS[q.subtype] || '주관식'}</div>
        <textarea class="subjective-area" id="subj-input" placeholder="답을 입력하세요...">${saved}</textarea>`;
    }

    const codeHtml   = q.code ? `<pre class="code-block">${escapeHtml(q.code)}</pre>` : '';
    const corrActive = ov === true  ? 'active' : '';
    const wronActive = ov === false ? 'active' : '';
    const nextDis    = canGoNext(idx) ? '' : 'disabled';
    const reqNote    = isSubj ? '<span class="required-note">* 정오답 선택 필수</span>' : '';

    const favActive = isFavorite(q.id) ? 'active' : '';
    container.innerHTML = `
      <div class="card question-card">
        <button class="btn-fav ${favActive}" id="btn-fav" title="즐겨찾기">★</button>
        <div class="q-meta">
          <span class="q-num">문제 ${idx + 1}</span>
          <span class="type-badge type-${q.type}">${TYPE_LABELS[q.type]}</span>
          ${reqNote}
        </div>

        <div class="q-text-wrap">
          <div class="q-text" id="q-text-display">${escapeHtml(displayQuestion)}</div>
          <button class="btn-text btn-edit-q" id="btn-edit-q" title="문제 텍스트 수정">✏ 수정</button>
        </div>
        <div class="q-edit-wrap" id="q-edit-wrap" style="display:none">
          <textarea class="q-edit-area" id="q-edit-area">${escapeHtml(displayQuestion)}</textarea>
          <div class="q-edit-actions">
            <button class="btn-primary btn-sm" id="btn-edit-save">저장</button>
            <button class="btn-secondary btn-sm" id="btn-edit-cancel">취소</button>
          </div>
        </div>

        ${codeHtml}
        <div id="answer-input-wrap">${inputHtml}</div>

        <div class="answer-toggle-row">
          <button class="btn-text" id="btn-toggle">▶ 정답 보기</button>
        </div>
        <div class="answer-section" id="answer-section">
          <div class="answer-label">모범 답안</div>
          <div class="answer-value">${answerDisplay(q)}</div>
          ${q.explanation ? `<div class="explanation">${escapeHtml(q.explanation)}</div>` : ''}
          <div class="note-section">
            <div class="note-section-header">
              <span class="note-label">내 메모</span>
              <span class="note-count" id="note-count"></span>
            </div>
            <div class="note-list" id="note-list"></div>
            <div class="note-compose">
              <textarea class="note-area" id="note-input" placeholder="메모를 입력하세요... (Ctrl+Enter로 저장)"></textarea>
              <div class="note-compose-footer">
                <button class="btn-primary btn-sm" id="btn-note-save">저장</button>
              </div>
            </div>
          </div>
        </div>

        <div class="override-row">
          <span class="override-label">자가 채점</span>
          <button class="btn-override btn-correct ${corrActive}" id="btn-corr">✔ 맞음</button>
          <button class="btn-override btn-wrong ${wronActive}" id="btn-wron">✘ 틀림</button>
        </div>

        <div class="nav-row">
          <button class="btn-secondary" id="btn-prev" ${idx === 0 ? 'disabled' : ''}>이전</button>
          <button class="btn-pass" id="btn-pass">패스 →</button>
          <button class="btn-primary" id="btn-next" ${nextDis}>${isLast ? '제출' : '다음'}</button>
        </div>
      </div>`;

    // 이벤트: 답안 선택
    if (q.type === 'ox' || q.type === 'multiple') {
      container.querySelectorAll('.option-item').forEach(item => {
        item.addEventListener('click', () => {
          const raw = item.dataset.val;
          examData.answers[idx] = q.type === 'ox' ? raw === 'true' : parseInt(raw, 10);
          container.querySelectorAll('.option-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          save();
        });
      });
    } else {
      document.getElementById('subj-input').addEventListener('input', e => {
        examData.answers[idx] = e.target.value;
        save();
      });
    }

    // 이벤트: 정답 토글
    const answerSec = document.getElementById('answer-section');
    document.getElementById('btn-toggle').addEventListener('click', function () {
      const visible = answerSec.classList.toggle('visible');
      this.textContent = visible ? '▼ 정답 숨기기' : '▶ 정답 보기';
    });

    // 이벤트: 메모 (댓글형)
    function renderNoteList() {
      const notes   = loadNotes(q.id);
      const countEl = document.getElementById('note-count');
      const listEl  = document.getElementById('note-list');
      if (!listEl) return;

      if (countEl) countEl.textContent = notes.length > 0 ? `${notes.length}개` : '';

      if (notes.length === 0) {
        listEl.innerHTML = '<p class="note-empty">아직 메모가 없습니다.</p>';
        return;
      }

      listEl.innerHTML = notes.map(n => `
        <div class="note-item">
          <p class="note-item-text">${escapeHtml(n.text)}</p>
          <div class="note-item-footer">
            <span class="note-item-date">${escapeHtml(n.date)}</span>
            <button class="btn-text note-delete-btn" data-nid="${n.id}">삭제</button>
          </div>
        </div>`).join('');

      listEl.querySelectorAll('.note-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const nid     = parseInt(btn.dataset.nid, 10);
          const updated = loadNotes(q.id).filter(n => n.id !== nid);
          saveNotes(q.id, updated);
          renderNoteList();
        });
      });
    }
    renderNoteList();

    const noteInput = document.getElementById('note-input');

    function submitNote() {
      const text = noteInput.value.trim();
      if (!text) return;
      const notes = loadNotes(q.id);
      notes.push({ id: Date.now(), text, date: formatDateTime(new Date()) });
      saveNotes(q.id, notes);
      noteInput.value = '';
      renderNoteList();
    }

    document.getElementById('btn-note-save').addEventListener('click', submitNote);

    noteInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submitNote(); }
    });

    // 이벤트: 문제 수정
    const qTextDisplay = document.getElementById('q-text-display');
    const qEditWrap    = document.getElementById('q-edit-wrap');
    const qEditArea    = document.getElementById('q-edit-area');

    document.getElementById('btn-edit-q').addEventListener('click', () => {
      qTextDisplay.parentElement.style.display = 'none';
      qEditWrap.style.display = 'block';
      qEditArea.focus();
      qEditArea.setSelectionRange(qEditArea.value.length, qEditArea.value.length);
    });

    document.getElementById('btn-edit-cancel').addEventListener('click', () => {
      qEditArea.value = loadQEdit(q.id) || q.question;
      qEditWrap.style.display = 'none';
      qTextDisplay.parentElement.style.display = '';
    });

    document.getElementById('btn-edit-save').addEventListener('click', () => {
      const newText = qEditArea.value.trim();
      if (newText) {
        saveQEdit(q.id, newText);
        qTextDisplay.textContent = newText;
      }
      qEditWrap.style.display = 'none';
      qTextDisplay.parentElement.style.display = '';
    });

    // 이벤트: 즐겨찾기
    document.getElementById('btn-fav').addEventListener('click', function () {
      const now = toggleFavorite(q.id, q);
      this.classList.toggle('active', now);
    });

    // 이벤트: 오버라이드
    function setOverride(val) {
      examData.overrides[idx] = val;
      document.getElementById('btn-corr').classList.toggle('active', val === true);
      document.getElementById('btn-wron').classList.toggle('active', val === false);
      save();
      if (isSubj) document.getElementById('btn-next').disabled = false;
    }
    document.getElementById('btn-corr').addEventListener('click', () => setOverride(true));
    document.getElementById('btn-wron').addEventListener('click', () => setOverride(false));

    // 이벤트: 내비게이션
    document.getElementById('btn-prev').addEventListener('click', () => {
      currentIndex--;
      save();
      renderQ(currentIndex);
    });
    document.getElementById('btn-next').addEventListener('click', () => {
      if (isLast) {
        clearInterval(timerInterval);
        sessionStorage.removeItem('examCurrentIndex');
        window.location.href = 'result.html';
      } else {
        currentIndex++;
        save();
        renderQ(currentIndex);
      }
    });

    // 이벤트: 패스 (틀림 처리 + 다음)
    document.getElementById('btn-pass').addEventListener('click', () => {
      setOverride(false);
      if (isLast) {
        clearInterval(timerInterval);
        sessionStorage.removeItem('examCurrentIndex');
        window.location.href = 'result.html';
      } else {
        currentIndex++;
        save();
        renderQ(currentIndex);
      }
    });
  }

  renderQ(currentIndex);

  // 이벤트: 시험 그만보기
  document.getElementById('btn-quit').addEventListener('click', () => {
    if (window.confirm('시험을 종료하시겠습니까?\n지금까지의 답안과 결과가 저장되지 않습니다.')) {
      clearInterval(timerInterval);
      clearExamData();
      window.location.href = 'index.html';
    }
  });
}

// ============================================================
// RESULT 페이지
// ============================================================

function initResultPage() {
  const examData = loadExamData();

  if (!examData || !examData.questions) {
    document.getElementById('result-content').style.display = 'none';
    document.getElementById('no-data-msg').style.display   = 'block';
    setupHistory();
    return;
  }

  const scores = scoreExam(examData);

  // 챕터 연습 모드 헤더 변경
  if (examData.mode === 'chapter') {
    const h1 = document.querySelector('.header-card h1');
    const desc = document.querySelector('.header-card .header-desc');
    if (h1) h1.textContent = '챕터 연습 결과';
    if (desc) {
      const chapters = examData.chapters || [];
      desc.textContent = chapters.length <= 3
        ? chapters.join(', ')
        : `${chapters.slice(0, 3).join(', ')} 외 ${chapters.length - 3}챕터`;
    }
  }

  // 자동 저장 (새 시험 결과일 때만 1회)
  if (!sessionStorage.getItem('resultSaved')) {
    const round = useRound();
    const text  = generateResultText(examData, scores, round);
    // 세션 내 다운로드용으로 sessionStorage에만 임시 보관
    sessionStorage.setItem('currentResultText', text);
    sessionStorage.setItem('resultSaved', String(round));

    // results/ 폴더에 파일로 저장
    const filename = `C_CPP_시험결과_${round}회차.txt`;
    writeResultFile(filename, text).then(ok => {
      const statusEl = document.getElementById('save-status');
      if (!statusEl) return;
      if (ok) {
        statusEl.textContent = `✔ 결과 파일 저장 완료: ${filename}`;
        statusEl.className   = 'save-status save-ok';
      } else {
        statusEl.textContent = '⚠ 파일 자동 저장 실패 (폴더 미설정 또는 권한 없음). 아래 버튼으로 수동 다운로드하세요.';
        statusEl.className   = 'save-status save-warn';
      }
      statusEl.style.display = 'block';
    });
  }

  const round = parseInt(sessionStorage.getItem('resultSaved'), 10);
  renderResult(examData, scores, round);
  setupHistory();
}

function renderHistoryDetail(text) {
  // ── 헤더 파싱 ──────────────────────────────────────────
  const oxM      = text.match(/\[O\/X\]\s+(\d+)\/4\s+정답\s+\((\d+)점\)/);
  const mcM      = text.match(/\[객관식\]\s+(\d+)\/6\s+정답\s+\((\d+)점\)/);
  const subM     = text.match(/\[주관식\]\s+(\d+)\/10\s+정답\s+\((\d+)점\)/);

  const summaryHtml = `
    <div class="hd-breakdown">
      <div class="hd-b-item">
        <span class="type-badge type-ox">O/X</span>
        <strong>${oxM?.[1] ?? '?'}</strong>/4
        <span class="hd-b-pts">${oxM?.[2] ?? '?'}점</span>
      </div>
      <div class="hd-b-item">
        <span class="type-badge type-multiple">객관식</span>
        <strong>${mcM?.[1] ?? '?'}</strong>/6
        <span class="hd-b-pts">${mcM?.[2] ?? '?'}점</span>
      </div>
      <div class="hd-b-item">
        <span class="type-badge type-subjective">주관식</span>
        <strong>${subM?.[1] ?? '?'}</strong>/10
        <span class="hd-b-pts">${subM?.[2] ?? '?'}점</span>
      </div>
    </div>`;

  // ── 문제별 파싱 ────────────────────────────────────────
  const qSection = text.split('--- 문제별 상세 ---')[1] || '';
  const qBlocks  = qSection.split(/\n(?=\d+\. \[)/).map(b => b.trim()).filter(Boolean);

  const qRows = qBlocks.map(block => {
    const lines     = block.split('\n');
    const firstLine = lines[0] || '';

    const numM      = firstLine.match(/^(\d+)\./);
    const typeM     = firstLine.match(/\[([^\]]+)\]/);
    const statusStr = firstLine.replace(/^\d+\.\s*\[[^\]]+\]\s*/, '').trim();
    const isCorrect = statusStr.startsWith('맞음');
    const isOverride = statusStr.includes('오버라이드');

    const get = (prefix) => {
      const line = lines.find(l => l.trimStart().startsWith(prefix));
      return line ? line.trimStart().slice(prefix.length).trim() : '';
    };

    const qText  = get('Q. ');
    const myAns  = get('내 답:');
    const corrAns = get('정답:').replace(/^정답:\s*/, '');  // 정답:  (두칸) 처리
    const expl   = get('해설:');

    const preview = qText.length > 55 ? qText.slice(0, 55) + '…' : qText;

    return `
      <div class="hd-q-row ${isCorrect ? 'hd-q-ok' : 'hd-q-fail'}">
        <div class="hd-q-top">
          <span class="hd-q-num">${numM?.[1] ?? ''}</span>
          <span class="hd-q-icon">${isCorrect ? '✔' : '✘'}</span>
          <span class="hd-q-badge type-badge type-${typeM?.[1] === 'O/X' ? 'ox' : typeM?.[1] === '객관식' ? 'multiple' : 'subjective'}">${typeM?.[1] ?? ''}</span>
          ${isOverride ? '<span class="hd-override-badge">수동</span>' : ''}
          <span class="hd-q-preview">${escapeHtml(preview)}</span>
        </div>
        ${!isCorrect ? `
          <div class="hd-q-ans">
            <span class="hd-my-ans">내 답: ${escapeHtml(myAns || '미응답')}</span>
            <span class="hd-arr">→</span>
            <span class="hd-corr-ans">정답: ${escapeHtml(corrAns)}</span>
          </div>
          ${expl ? `<p class="hd-q-expl">${escapeHtml(expl)}</p>` : ''}
        ` : ''}
      </div>`;
  }).join('');

  return `<div class="history-detail-body">${summaryHtml}<div class="hd-q-list">${qRows}</div></div>`;
}

function renderHistoryItems(container, items) {
  if (items.length === 0) {
    container.innerHTML = '<p class="file-hint">해당 유형의 기록이 없습니다.</p>';
    return;
  }
  container.innerHTML = items.map(r => {
    const scoreLabel = r.mode === 'chapter' ? `${r.totalScore}%` : `${r.totalScore}점`;
    const correctLabel = `${r.totalCorrect}/${r.totalQ}`;
    const sortedChapters = (r.chapters || []).slice().sort((a, b) => {
      const isCLangA = a.startsWith('C언어');
      const isCLangB = b.startsWith('C언어');
      if (isCLangA !== isCLangB) return isCLangA ? -1 : 1;  // C언어 먼저
      const numA = parseInt(a.match(/CH(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/CH(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    });
    const chapterTagsHtml = (r.mode === 'chapter' && sortedChapters.length > 0)
      ? `<div class="history-chapter-tags">${sortedChapters.map(ch => {
          const isCLang = ch.startsWith('C언어');
          return `<span class="history-ch-tag ${isCLang ? 'tag-c' : 'tag-cpp'}">${escapeHtml(ch)}</span>`;
        }).join('')}</div>`
      : '';
    return `
    <div class="history-item">
      <div class="history-meta">
        <span class="history-round">${r.round}회차</span>
        <span class="pass-chip-sm ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>
        <span class="history-score">${scoreLabel}</span>
        <span class="history-correct">${correctLabel}</span>
        <span class="history-date">${escapeHtml(r.date)}</span>
        <button class="btn-text history-toggle">▶ 상세</button>
      </div>
      ${chapterTagsHtml}
      <div class="history-detail" style="display:none">${renderHistoryDetail(r.text || '')}</div>
    </div>`;
  }).join('');

  container.querySelectorAll('.history-toggle').forEach(btn => {
    btn.addEventListener('click', function () {
      const detail  = this.closest('.history-item').querySelector('.history-detail');
      const visible = detail.style.display !== 'none';
      detail.style.display = visible ? 'none' : 'block';
      this.textContent = visible ? '▶ 상세' : '▼ 접기';
    });
  });
}

async function setupHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;

  container.innerHTML = '<p class="file-hint" style="color:#9AA0A6">기록을 불러오는 중...</p>';

  const results = await readResultFiles();

  if (results.length === 0) {
    const dir = await getResultsDir(false);
    container.innerHTML = dir
      ? '<p class="file-hint">저장된 시험 기록이 없습니다.</p>'
      : '<p class="file-hint">결과 저장 폴더가 설정되지 않았습니다.<br>홈 화면에서 폴더를 선택하면 기록이 표시됩니다.</p>';
    return;
  }

  const regularItems = results.filter(r => r.mode === 'regular');
  const chapterItems = results.filter(r => r.mode === 'chapter');

  // 탭 전환
  const tabs = document.querySelectorAll('.history-tab');
  let activeTab = 'regular';

  function switchTab(tab) {
    activeTab = tab;
    tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    renderHistoryItems(container, tab === 'regular' ? regularItems : chapterItems);
  }

  tabs.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 탭 카운트 표시
  tabs.forEach(btn => {
    const count = btn.dataset.tab === 'regular' ? regularItems.length : chapterItems.length;
    btn.textContent = `${btn.textContent} (${count})`;
  });

  switchTab('regular');
}

function renderResult(examData, scores, round) {
  const { results, oxCorrect, mcCorrect, subCorrect, totalCorrect, totalScore, pass, totalQ, isChapterMode } = scores;

  // 점수 요약
  document.getElementById('score-big').textContent = totalScore;
  const chip = document.getElementById('pass-chip');
  chip.textContent = pass ? 'PASS' : 'FAIL';
  chip.className   = `pass-chip ${pass ? 'pass' : 'fail'}`;

  // 합격 기준 텍스트
  const criteriaEl = document.querySelector('.pass-criteria');
  if (criteriaEl) {
    criteriaEl.textContent = isChapterMode
      ? `합격 기준: 60% 이상 정답 (${Math.ceil(totalQ * 0.6)}문제 이상 / ${totalQ}문제)`
      : '합격 기준: 12문제 이상 / 60점';
  }

  // 점수 분모
  const denomEl = document.querySelector('.score-denom');
  if (denomEl) denomEl.textContent = '/ 100점';

  const oxTotal  = results.filter(r => r.question.type === 'ox').length;
  const mcTotal  = results.filter(r => r.question.type === 'multiple').length;
  const subTotal = results.filter(r => r.question.type === 'subjective' || r.question.type === 'short').length;

  const pct = n => isChapterMode ? '' : `  (${n * 5}점)`;
  document.getElementById('ox-row').textContent    = `${oxCorrect} / ${oxTotal} 정답${pct(oxCorrect)}`;
  document.getElementById('mc-row').textContent    = `${mcCorrect} / ${mcTotal} 정답${pct(mcCorrect)}`;
  document.getElementById('sub-row').textContent   = `${subCorrect} / ${subTotal} 정답${pct(subCorrect)}`;
  document.getElementById('total-row').textContent = `${totalCorrect} / ${totalQ} 문제`;

  // 챕터별 요약
  const chMap     = buildChapterSummary(results);
  const chSummary = document.getElementById('chapter-summary');
  const entries   = Object.entries(chMap).sort((a, b) => a[0].localeCompare(b[0], 'ko'));

  chSummary.innerHTML = entries.map(([ch, stat]) => {
    const wrong = stat.total - stat.correct;
    const allOk = wrong === 0;
    return `
      <div class="chapter-row ${allOk ? 'ch-ok-row' : 'ch-bad-row'}">
        <span class="ch-name">${escapeHtml(ch)}</span>
        <span class="ch-stat">
          ${allOk
            ? `<span class="ch-correct-tag">✔ ${stat.correct}/${stat.total} 전부 정답</span>`
            : `<span class="ch-wrong-tag">✘ ${wrong}문제 틀림</span><span class="ch-count">${stat.correct}/${stat.total} 정답</span>`
          }
        </span>
      </div>`;
  }).join('');

  // 다운로드 버튼 (세션 내 결과를 sessionStorage에서 읽음)
  document.getElementById('btn-redownload').addEventListener('click', () => {
    const text = sessionStorage.getItem('currentResultText');
    if (!text) { alert('다운로드할 결과를 찾을 수 없습니다.\nresults 폴더에 저장된 파일을 직접 사용하세요.'); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `C_CPP_시험결과_${round}회차.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // 새 시험
  document.getElementById('btn-new-exam').addEventListener('click', () => {
    clearExamData();
    window.location.href = 'index.html';
  });
}

// ============================================================
// MANAGE 페이지
// ============================================================

async function initManagePage() {
  const PAGE_SIZE = 15;
  let currentPage   = 1;
  let filterType    = '';
  let filterChapter = '';
  let filterSearch  = '';
  let editingId     = null;   // null = 추가 모드

  // ── 데이터 ──────────────────────────────────────────────
  let baseQuestions = [];
  try { baseQuestions = await loadBaseQuestions(); }
  catch (e) { console.error('기본 문제 로드 실패:', e); }

  function getAllQuestions() {
    const deleted = loadDeletedIds();
    const processed = baseQuestions
      .filter(q => !deleted.has(q.id))
      .map(q => { const ov = loadQFull(q.id); return { ...(ov ? { ...q, ...ov, id: q.id } : q), _base: true }; });
    const userQs = loadUserQuestions()
      .filter(q => !deleted.has(q.id))
      .map(q => ({ ...q, _user: true }));
    return [...processed, ...userQs];
  }

  function getFiltered() {
    return getAllQuestions().filter(q => {
      if (filterType    && q.type    !== filterType)    return false;
      if (filterChapter && q.chapter !== filterChapter) return false;
      if (filterSearch) {
        const s = filterSearch.toLowerCase();
        const inQ = (q.question || '').toLowerCase().includes(s);
        const inC = (q.chapter  || '').toLowerCase().includes(s);
        const inA = String(q.answer ?? '').toLowerCase().includes(s);
        return inQ || inC || inA;
      }
      return true;
    });
  }

  function getChapters() {
    return [...new Set(getAllQuestions().map(q => q.chapter).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ko'));
  }

  // ── 렌더 ─────────────────────────────────────────────────
  function renderStats() {
    const all  = getAllQuestions();
    const ox   = all.filter(q => q.type === 'ox').length;
    const mc   = all.filter(q => q.type === 'multiple').length;
    const subj = all.filter(q => q.type === 'subjective' || q.type === 'short').length;
    const statsEl = document.getElementById('manage-stats');
    if (statsEl) statsEl.innerHTML = `
      <span class="stat-item">전체 <strong>${all.length}</strong></span>
      <span class="stat-sep">·</span>
      <span class="stat-item"><span class="type-badge type-ox">O/X</span> <strong>${ox}</strong></span>
      <span class="stat-sep">·</span>
      <span class="stat-item"><span class="type-badge type-multiple">객관식</span> <strong>${mc}</strong></span>
      <span class="stat-sep">·</span>
      <span class="stat-item"><span class="type-badge type-subjective">주관식/단답</span> <strong>${subj}</strong></span>`;
  }

  function populateChapterFilter() {
    const sel = document.getElementById('filter-chapter');
    if (!sel) return;
    sel.innerHTML = '<option value="">전체 챕터</option>' +
      getChapters().map(ch =>
        `<option value="${escapeHtml(ch)}" ${ch === filterChapter ? 'selected' : ''}>${escapeHtml(ch)}</option>`
      ).join('');
  }

  function buildDetailHtml(q) {
    const fullText = loadQEdit(q.id) || q.question || '';

    let answerHtml = '';
    if (q.type === 'ox') {
      const yes = q.answer === true;
      answerHtml = `
        <div class="detail-row">
          <span class="detail-lbl">정답</span>
          <span class="detail-ans-chip ${yes ? 'chip-pass' : 'chip-fail'}">${yes ? 'O &nbsp;(참)' : 'X &nbsp;(거짓)'}</span>
        </div>`;
    } else if (q.type === 'multiple') {
      answerHtml = `
        <div class="detail-row detail-options-wrap">
          <span class="detail-lbl">보기</span>
          <div class="detail-options">
            ${(q.options || []).map((opt, i) => `
              <div class="detail-option ${i === q.answer ? 'detail-option-correct' : ''}">
                <span class="detail-opt-circle">${CIRCLES[i]}</span>
                <span class="detail-opt-text">${escapeHtml(opt)}</span>
                ${i === q.answer ? '<span class="detail-correct-mark">✔ 정답</span>' : ''}
              </div>`).join('')}
          </div>
        </div>`;
    } else {
      answerHtml = `
        <div class="detail-row">
          <span class="detail-lbl">모범 답안</span>
          <span class="detail-ans-text">${escapeHtml(String(q.answer ?? ''))}</span>
        </div>`;
    }

    const codeHtml = q.code
      ? `<pre class="code-block detail-code">${escapeHtml(q.code)}</pre>`
      : '';

    const explHtml = q.explanation ? `
      <div class="detail-row">
        <span class="detail-lbl">해설</span>
        <span class="detail-expl">${escapeHtml(q.explanation)}</span>
      </div>` : '';

    const noteCount = loadNotes(q.id).length;
    const noteHtml  = noteCount > 0
      ? `<div class="detail-note-info"><span class="note-count">${noteCount}개</span> 메모 저장됨</div>`
      : '';

    return `
      <div class="qmc-detail">
        <p class="detail-full-question">${escapeHtml(fullText)}</p>
        ${codeHtml}
        ${answerHtml}
        ${explHtml}
        ${noteHtml}
      </div>`;
  }

  function renderList() {
    const filtered   = getFiltered();
    const total      = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    renderStats();
    populateChapterFilter();

    const container = document.getElementById('q-list-container');
    if (!container) return;

    if (page.length === 0) {
      container.innerHTML = '<div class="card" style="text-align:center;padding:32px;color:#9AA0A6">검색 결과가 없습니다.</div>';
    } else {
      container.innerHTML = page.map((q, localIdx) => {
        const globalIdx   = start + localIdx + 1;
        const rawText     = loadQEdit(q.id) || q.question || '';
        const preview     = rawText.length > 90 ? rawText.slice(0, 90) + '…' : rawText;
        const hasOverride = q._base && !!loadQFull(q.id);
        return `
          <div class="card q-manage-card">
            <div class="qmc-header">
              <div class="qmc-meta">
                <span class="qmc-num">${globalIdx}</span>
                <span class="type-badge type-${q.type}">${TYPE_LABELS[q.type] || q.type}</span>
                ${q.chapter ? `<span class="qmc-chapter">${escapeHtml(q.chapter)}</span>` : ''}
                ${q._user     ? '<span class="badge-user">사용자 추가</span>' : ''}
                ${hasOverride ? '<span class="badge-edited">수정됨</span>'    : ''}
              </div>
              <div class="qmc-actions">
                <button class="btn-text qmc-detail-btn" data-id="${escapeHtml(q.id)}">▶ 상세</button>
                <button class="btn-text qmc-edit-btn"   data-id="${escapeHtml(q.id)}">수정</button>
                <button class="btn-text qmc-del-btn"    data-id="${escapeHtml(q.id)}" style="color:#D93025">삭제</button>
              </div>
            </div>
            <p class="qmc-preview">${escapeHtml(preview)}</p>
            ${q.code ? '<p class="qmc-code-hint">코드 포함</p>' : ''}
            <div class="qmc-detail-wrap" style="display:none">${buildDetailHtml(q)}</div>
          </div>`;
      }).join('');
    }

    renderPagination(total, totalPages);

    container.querySelectorAll('.qmc-detail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card    = btn.closest('.q-manage-card');
        const wrap    = card.querySelector('.qmc-detail-wrap');
        const visible = wrap.style.display !== 'none';
        wrap.style.display   = visible ? 'none' : 'block';
        btn.textContent      = visible ? '▶ 상세' : '▼ 접기';
        btn.classList.toggle('detail-open', !visible);
      });
    });
    container.querySelectorAll('.qmc-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
    container.querySelectorAll('.qmc-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteQ(btn.dataset.id)));
  }

  function renderPagination(total, totalPages) {
    const el = document.getElementById('pagination');
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    // 앞뒤 2페이지 + 처음/끝
    const visible = new Set([1, totalPages]);
    for (let p = Math.max(1, currentPage - 2); p <= Math.min(totalPages, currentPage + 2); p++) visible.add(p);
    const sorted = [...visible].sort((a, b) => a - b);

    let html = `<button class="btn-page" id="pg-prev" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
    let prev = 0;
    sorted.forEach(p => {
      if (p - prev > 1) html += `<span class="pg-ellipsis">…</span>`;
      html += `<button class="btn-page ${p === currentPage ? 'active' : ''}" data-p="${p}">${p}</button>`;
      prev = p;
    });
    html += `<button class="btn-page" id="pg-next" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
    html += `<span class="pg-info">${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} / ${total}문제</span>`;

    el.innerHTML = html;
    el.querySelector('#pg-prev').addEventListener('click', () => { currentPage--; renderList(); window.scrollTo(0, 0); });
    el.querySelector('#pg-next').addEventListener('click', () => { currentPage++; renderList(); window.scrollTo(0, 0); });
    el.querySelectorAll('[data-p]').forEach(btn =>
      btn.addEventListener('click', () => { currentPage = parseInt(btn.dataset.p, 10); renderList(); window.scrollTo(0, 0); }));
  }

  // ── 삭제 ──────────────────────────────────────────────────
  function deleteQ(id) {
    if (!window.confirm('이 문제를 삭제하시겠습니까?\n(기본 문제는 숨김 처리되며 복구할 수 없습니다.)')) return;
    const userQs = loadUserQuestions();
    if (userQs.some(q => q.id === id)) {
      saveUserQuestions(userQs.filter(q => q.id !== id));
    } else {
      addDeletedId(id);
      clearQFull(id);
    }
    renderList();
  }

  // ── 모달 ──────────────────────────────────────────────────
  const overlay  = document.getElementById('modal-overlay');
  const formErr  = document.getElementById('form-error');

  function showModal()  { overlay.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
  function closeModal() { overlay.style.display = 'none'; document.body.style.overflow = ''; editingId = null; }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // 유형 선택 → 필드 토글
  function getSelectedType() {
    const r = document.querySelector('input[name="q-type"]:checked');
    return r ? r.value : null;
  }

  function updateFormFields() {
    const type = getSelectedType();
    document.getElementById('f-ox-wrap').style.display     = type === 'ox'         ? 'block' : 'none';
    document.getElementById('f-mc-wrap').style.display     = type === 'multiple'   ? 'block' : 'none';
    document.getElementById('f-subj-wrap').style.display   = type === 'subjective' ? 'block' : 'none';
    document.getElementById('f-code-row').style.display    = (type === 'subjective' || type === 'short') ? 'block' : 'none';
    document.getElementById('f-answer-row').style.display  = (type === 'ox' || type === 'multiple') ? 'none' : (type ? 'block' : 'none');
  }

  document.querySelectorAll('input[name="q-type"]').forEach(r =>
    r.addEventListener('change', updateFormFields));

  function clearForm() {
    document.querySelectorAll('input[name="q-type"]').forEach(r => r.checked = false);
    document.querySelectorAll('input[name="ox-ans"]').forEach(r => r.checked = false);
    document.querySelectorAll('input[name="mc-ans"]').forEach(r => r.checked = false);
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById(`mc-opt-${i}`);
      if (el) el.value = '';
    }
    ['f-chapter','f-question','f-code','f-answer','f-explanation'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const sub = document.getElementById('f-subtype');
    if (sub) sub.value = 'code_blank';
    if (formErr) { formErr.textContent = ''; formErr.style.display = 'none'; }
    updateFormFields();
  }

  function fillForm(q) {
    const typeRadio = document.querySelector(`input[name="q-type"][value="${q.type}"]`);
    if (typeRadio) typeRadio.checked = true;
    updateFormFields();

    document.getElementById('f-chapter').value     = q.chapter     || '';
    document.getElementById('f-question').value    = q.question    || '';
    document.getElementById('f-code').value        = q.code        || '';
    document.getElementById('f-explanation').value = q.explanation || '';

    if (q.type === 'ox') {
      const r = document.querySelector(`input[name="ox-ans"][value="${q.answer}"]`);
      if (r) r.checked = true;
    } else if (q.type === 'multiple') {
      (q.options || []).forEach((opt, i) => {
        const inp = document.getElementById(`mc-opt-${i}`);
        if (inp) inp.value = opt;
      });
      const r = document.querySelector(`input[name="mc-ans"][value="${q.answer}"]`);
      if (r) r.checked = true;
    } else {
      document.getElementById('f-answer').value = String(q.answer ?? '');
    }
    const sub = document.getElementById('f-subtype');
    if (sub && q.subtype) sub.value = q.subtype;
  }

  function validateForm() {
    const type = getSelectedType();
    if (!type) return '유형을 선택하세요.';
    if (!document.getElementById('f-question').value.trim()) return '문제 내용을 입력하세요.';
    if (type === 'ox') {
      if (!document.querySelector('input[name="ox-ans"]:checked')) return '정답(O/X)을 선택하세요.';
    } else if (type === 'multiple') {
      for (let i = 0; i < 5; i++) {
        if (!document.getElementById(`mc-opt-${i}`).value.trim()) return `보기 ${i + 1}을 입력하세요.`;
      }
      if (!document.querySelector('input[name="mc-ans"]:checked')) return '정답 보기를 선택하세요.';
    } else {
      if (!document.getElementById('f-answer').value.trim()) return '모범 답안을 입력하세요.';
    }
    return null;
  }

  function collectForm() {
    const type = getSelectedType();
    const q = {
      type,
      chapter:     document.getElementById('f-chapter').value.trim(),
      question:    document.getElementById('f-question').value.trim(),
      explanation: document.getElementById('f-explanation').value.trim(),
    };
    const code = document.getElementById('f-code').value.trim();
    if (code) q.code = code;

    if (type === 'ox') {
      q.answer = document.querySelector('input[name="ox-ans"]:checked').value === 'true';
    } else if (type === 'multiple') {
      q.options = [0,1,2,3,4].map(i => document.getElementById(`mc-opt-${i}`).value.trim());
      q.answer  = parseInt(document.querySelector('input[name="mc-ans"]:checked').value, 10);
    } else {
      q.answer = document.getElementById('f-answer').value.trim();
      if (type === 'subjective') q.subtype = document.getElementById('f-subtype').value;
    }
    return q;
  }

  function openAddModal() {
    editingId = null;
    document.getElementById('modal-title').textContent = '문제 추가';
    clearForm();
    showModal();
  }

  function openEditModal(id) {
    const q = getAllQuestions().find(x => x.id === id);
    if (!q) return;
    editingId = id;
    document.getElementById('modal-title').textContent = '문제 수정';
    clearForm();
    fillForm(q);
    showModal();
  }

  document.getElementById('btn-modal-save').addEventListener('click', () => {
    const err = validateForm();
    if (err) {
      formErr.textContent = err;
      formErr.style.display = 'block';
      return;
    }
    formErr.style.display = 'none';

    const q = collectForm();

    if (editingId === null) {
      q.id = `user_${Date.now()}`;
      const userQs = loadUserQuestions();
      userQs.push(q);
      saveUserQuestions(userQs);
    } else {
      const userQs = loadUserQuestions();
      const uIdx   = userQs.findIndex(x => x.id === editingId);
      if (uIdx >= 0) {
        userQs[uIdx] = { ...q, id: editingId };
        saveUserQuestions(userQs);
      } else {
        saveQFull(editingId, q);
      }
    }

    closeModal();
    renderList();
  });

  // ── 필터 이벤트 ──────────────────────────────────────────
  document.getElementById('filter-type').addEventListener('change', e => {
    filterType = e.target.value; currentPage = 1; renderList();
  });
  document.getElementById('filter-chapter').addEventListener('change', e => {
    filterChapter = e.target.value; currentPage = 1; renderList();
  });
  document.getElementById('filter-search').addEventListener('input', e => {
    filterSearch = e.target.value; currentPage = 1; renderList();
  });
  document.getElementById('btn-add-q').addEventListener('click', openAddModal);

  // 초기 렌더
  renderList();
}

// ============================================================
// 라우터
// ============================================================

// ============================================================
// FAVORITES 페이지
// ============================================================

async function initFavoritesPage() {
  const listEl  = document.getElementById('fav-list');
  const emptyEl = document.getElementById('fav-empty');

  const favs = loadFavoriteQuestions();
  if (favs.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  function answerDisplay(q) {
    if (q.type === 'ox')       return q.answer ? 'O &nbsp;(참)' : 'X &nbsp;(거짓)';
    if (q.type === 'multiple') return `${CIRCLES[q.answer]} ${escapeHtml(q.options[q.answer])}`;
    return escapeHtml(q.answer);
  }

  listEl.innerHTML = favs.map(q => {
    const displayQ = loadQEdit(q.id) || q.question;
    const codeHtml = q.code ? `<pre class="code-block">${escapeHtml(q.code)}</pre>` : '';
    return `
      <div class="card fav-card" data-id="${escapeHtml(q.id)}">
        <button class="btn-fav active fav-remove-btn" data-id="${escapeHtml(q.id)}" title="즐겨찾기 해제">★</button>
        <div class="q-meta">
          <span class="type-badge type-${q.type}">${TYPE_LABELS[q.type]}</span>
          <span class="fav-chapter">${escapeHtml(q.chapter || '')}</span>
        </div>
        <p class="q-text">${escapeHtml(displayQ)}</p>
        ${codeHtml}
        <div class="fav-answer-row">
          <span class="fav-ans-label">정답</span>
          <span class="fav-ans-value">${answerDisplay(q)}</span>
        </div>
        ${q.explanation ? `<p class="explanation">${escapeHtml(q.explanation)}</p>` : ''}
      </div>`;
  }).join('');

  listEl.querySelectorAll('.fav-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!window.confirm('즐겨찾기를 해제하시겠습니까?')) return;
      const id = btn.dataset.id;
      toggleFavorite(id);
      btn.closest('.fav-card').remove();
      if (listEl.querySelectorAll('.fav-card').length === 0) {
        emptyEl.style.display = 'block';
      }
    });
  });
}

// ============================================================
// 챕터 연습 선택 페이지
// ============================================================

async function initChapterSelectPage() {
  const loadingEl  = document.getElementById('chapter-loading');
  const contentEl  = document.getElementById('chapter-content');
  const cppListEl  = document.getElementById('chapter-list-cpp');
  const cListEl    = document.getElementById('chapter-list-c');
  const poolDescEl = document.getElementById('pool-desc');
  const errorEl    = document.getElementById('chapter-error');
  const qCountEl   = document.getElementById('q-count');
  const startBtn   = document.getElementById('btn-chapter-start');
  const checkAllCpp = document.getElementById('check-all-cpp');
  const checkAllC   = document.getElementById('check-all-c');

  // C++ 챕터 순서
  const CPP_CHAPTERS = [
    'CH01 C++ 기초', 'CH02 예외처리', 'CH03 클래스와 객체',
    'CH04 객체포인터와 객체배열', 'CH05 참조와 복사생성자',
    'CH06 함수중복과 const 정적함수', 'CH07 연산자 오버로딩과 입출력스트림',
    'CH08 상속과 다형성', 'CH09 파일입출력', 'CH10 템플릿'
  ];
  const C_CHAPTERS = [
    'C언어 CH01 C 언어 개요와 프로그램 작성', 'C언어 CH02 C 언어 시작하기',
    'C언어 CH03 기본 자료형과 변수', 'C언어 CH04 콘솔 입출력과 연산자',
    'C언어 CH05 제어문', 'C언어 CH06 함수', 'C언어 CH07 기억 클래스',
    'C언어 CH08 배열과 문자열', 'C언어 CH09 문자열 처리함수와 다차원 배열',
    'C언어 CH10 포인터', 'C언어 CH11 구조체', 'C언어 CH12 파일입출력'
  ];

  let allQuestions = [];
  let chapterMap   = {};  // chapter → [questions]

  try {
    const pools = await loadAllQuestions();
    allQuestions = [...pools.ox, ...pools.multiple, ...pools.subjective];
    allQuestions.forEach(q => {
      const ch = q.chapter || '기타';
      if (!chapterMap[ch]) chapterMap[ch] = [];
      chapterMap[ch].push(q);
    });
  } catch {
    loadingEl.textContent = '⚠ 문제 파일을 불러올 수 없습니다.';
    return;
  }

  loadingEl.style.display = 'none';
  contentEl.style.display = 'block';

  function renderChapterList(el, chapters) {
    el.innerHTML = '';
    chapters.forEach(ch => {
      const count = (chapterMap[ch] || []).length;
      const item = document.createElement('label');
      item.className = 'chapter-item';
      item.innerHTML = `
        <input type="checkbox" value="${escapeHtml(ch)}" ${count === 0 ? 'disabled' : ''}>
        <span class="chapter-item-name">${escapeHtml(ch)}</span>
        <span class="chapter-item-count">${count}문제</span>`;
      item.addEventListener('change', () => {
        item.classList.toggle('selected', item.querySelector('input').checked);
        updatePoolDesc();
      });
      if (count === 0) item.style.opacity = '0.4';
      el.appendChild(item);
    });
  }

  renderChapterList(cppListEl, CPP_CHAPTERS);
  renderChapterList(cListEl,   C_CHAPTERS);

  function getSelectedChapters() {
    return [...document.querySelectorAll('.chapter-list input[type="checkbox"]:checked')]
      .map(cb => cb.value);
  }

  function getPoolSize() {
    return getSelectedChapters().reduce((sum, ch) => sum + (chapterMap[ch] || []).length, 0);
  }

  function updatePoolDesc() {
    const total = getPoolSize();
    const selected = getSelectedChapters().length;
    if (selected === 0) {
      poolDescEl.textContent = '챕터를 선택하세요';
    } else {
      poolDescEl.textContent = `선택 ${selected}챕터 · ${total}문제 풀`;
      if (qCountEl.value > total) qCountEl.value = total;
      qCountEl.max = total;
    }
  }
  updatePoolDesc();

  // 전체 선택 체크박스
  function setupSelectAll(checkAllEl, listEl) {
    checkAllEl.addEventListener('change', () => {
      listEl.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => {
        cb.checked = checkAllEl.checked;
        cb.closest('.chapter-item').classList.toggle('selected', checkAllEl.checked);
      });
      updatePoolDesc();
    });
  }
  setupSelectAll(checkAllCpp, cppListEl);
  setupSelectAll(checkAllC,   cListEl);

  qCountEl.addEventListener('input', updatePoolDesc);

  startBtn.addEventListener('click', () => {
    errorEl.style.display = 'none';
    const selected = getSelectedChapters();
    if (selected.length === 0) {
      errorEl.textContent = '⚠ 챕터를 하나 이상 선택하세요.';
      errorEl.style.display = 'block';
      return;
    }
    const n = parseInt(qCountEl.value, 10);
    if (!n || n < 1) {
      errorEl.textContent = '⚠ 문제 수를 1 이상으로 입력하세요.';
      errorEl.style.display = 'block';
      return;
    }
    const pool = selected.flatMap(ch => chapterMap[ch] || []);
    if (pool.length === 0) {
      errorEl.textContent = '⚠ 선택한 챕터에 문제가 없습니다.';
      errorEl.style.display = 'block';
      return;
    }
    const questions = shuffleArray(pool).slice(0, Math.min(n, pool.length));
    clearExamData();
    saveExamData({
      questions,
      answers:   {},
      overrides: {},
      startTime: Date.now(),
      mode:      'chapter',
      chapters:  selected
    });
    window.location.href = 'exam.html';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // 이전 버전 localStorage 결과 데이터 정리
  Object.keys(localStorage)
    .filter(k => k.startsWith('examResult_'))
    .forEach(k => localStorage.removeItem(k));

  const page = document.body.dataset.page;
  if (page === 'index')          initIndexPage();
  else if (page === 'exam')           initExamPage();
  else if (page === 'result')         initResultPage();
  else if (page === 'manage')         initManagePage();
  else if (page === 'favorites')      initFavoritesPage();
  else if (page === 'chapter-select') initChapterSelectPage();
});
