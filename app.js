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

async function loadAllQuestions() {
  const mRes = await fetch('./questions/manifest.json');
  if (!mRes.ok) throw new Error('manifest.json을 찾을 수 없습니다.');
  const files = await mRes.json();

  const responses = await Promise.all(files.map(f => fetch(`./questions/${f}`)));
  responses.forEach((r, i) => { if (!r.ok) throw new Error(`${files[i]} 로드 실패`); });
  const arrays  = await Promise.all(responses.map(r => r.json()));
  const all     = arrays.flat();

  return {
    ox:         all.filter(q => q.type === 'ox'),
    multiple:   all.filter(q => q.type === 'multiple'),
    subjective: all.filter(q => q.type === 'subjective' || q.type === 'short')
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
  const totalScore   = totalCorrect * 5;
  const pass         = totalCorrect >= 12;

  return { results, oxCorrect, mcCorrect, subCorrect, totalCorrect, totalScore, pass };
}

// ============================================================
// localStorage 결과 저장 / 조회
// ============================================================

function saveResultToStorage(round, scores, text) {
  localStorage.setItem(`examResult_${round}`, JSON.stringify({
    round,
    date: new Date().toISOString(),
    totalScore: scores.totalScore,
    pass: scores.pass,
    totalCorrect: scores.totalCorrect,
    text
  }));
}

function getAllStoredResults() {
  const results = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('examResult_')) {
      try { results.push(JSON.parse(localStorage.getItem(key))); }
      catch { /* skip */ }
    }
  }
  return results.sort((a, b) => b.round - a.round);
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
  const { results, oxCorrect, mcCorrect, subCorrect, totalCorrect, totalScore, pass } = scores;
  const now  = formatDateTime(new Date());
  const lines = [];

  lines.push(`===== C/C++ 이론 시험 결과 (${round}회차) =====`);
  lines.push(`날짜: ${now}`);
  lines.push(`총점: ${totalScore} / 100  |  판정: ${pass ? 'PASS ✔' : 'FAIL ✘'}  (합격 기준: 60점 / 12문제)`);
  lines.push('');
  lines.push(`[O/X]    ${oxCorrect}/4 정답  (${oxCorrect * 5}점)`);
  lines.push(`[객관식]  ${mcCorrect}/6 정답  (${mcCorrect * 5}점)`);
  lines.push(`[주관식]  ${subCorrect}/10 정답  (${subCorrect * 5}점)`);
  lines.push(`정답 문제: ${totalCorrect} / 20`);
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
        startTime: new Date().toISOString()
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

  let currentIndex = parseInt(sessionStorage.getItem('examCurrentIndex') || '0', 10);
  const total      = examData.questions.length;

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

    container.innerHTML = `
      <div class="card question-card">
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

  // 자동 저장 (새 시험 결과일 때만 1회)
  if (!sessionStorage.getItem('resultSaved')) {
    const round = useRound();
    const text  = generateResultText(examData, scores, round);
    saveResultToStorage(round, scores, text);
    sessionStorage.setItem('resultSaved', String(round));

    // results/ 폴더에 파일 저장 (File System Access API)
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

function setupHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;

  const results = getAllStoredResults();
  if (results.length === 0) {
    container.innerHTML = '<p class="file-hint">저장된 시험 기록이 없습니다.</p>';
    return;
  }

  container.innerHTML = results.map(r => `
    <div class="history-item">
      <div class="history-meta">
        <span class="history-round">${r.round}회차</span>
        <span class="pass-chip-sm ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>
        <span class="history-score">${r.totalScore}점</span>
        <span class="history-correct">${r.totalCorrect}/20</span>
        <span class="history-date">${formatDateTime(new Date(r.date))}</span>
        <button class="btn-text history-toggle">▶ 상세</button>
      </div>
      <pre class="file-view history-detail" style="display:none">${escapeHtml(r.text || '')}</pre>
    </div>`).join('');

  container.querySelectorAll('.history-toggle').forEach(btn => {
    btn.addEventListener('click', function () {
      const detail  = this.closest('.history-item').querySelector('.history-detail');
      const visible = detail.style.display !== 'none';
      detail.style.display = visible ? 'none' : 'block';
      this.textContent = visible ? '▶ 상세' : '▼ 접기';
    });
  });
}

function renderResult(examData, scores, round) {
  const { results, oxCorrect, mcCorrect, subCorrect, totalCorrect, totalScore, pass } = scores;

  // 점수 요약
  document.getElementById('score-big').textContent = totalScore;
  const chip = document.getElementById('pass-chip');
  chip.textContent = pass ? 'PASS' : 'FAIL';
  chip.className   = `pass-chip ${pass ? 'pass' : 'fail'}`;

  document.getElementById('ox-row').textContent    = `${oxCorrect} / 4 정답  (${oxCorrect * 5}점)`;
  document.getElementById('mc-row').textContent    = `${mcCorrect} / 6 정답  (${mcCorrect * 5}점)`;
  document.getElementById('sub-row').textContent   = `${subCorrect} / 10 정답  (${subCorrect * 5}점)`;
  document.getElementById('total-row').textContent = `${totalCorrect} / 20 문제`;

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

  // 다운로드 버튼
  document.getElementById('btn-redownload').addEventListener('click', () => {
    const stored = localStorage.getItem(`examResult_${round}`);
    if (!stored) return;
    const { text } = JSON.parse(stored);
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
// 라우터
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'index')  initIndexPage();
  else if (page === 'exam')   initExamPage();
  else if (page === 'result') initResultPage();
});
