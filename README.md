# C/C++ 이론 시험 📝

C/C++ 수업 내용을 기반으로 문제은행에서 자동 출제하는 **로컬 시험 웹사이트**입니다.  
Google Forms 스타일 UI · 자동채점 · 자가채점 · 챕터별 결과 분석 · 시험 기록 관리

---

## 빠른 시작 (다운로드 후 바로 실행)

### 1단계 — 파일 다운로드

**방법 A: ZIP 다운로드** (Git 없이 바로 사용)

1. 이 페이지 상단 초록색 **`<> Code`** 버튼 클릭
2. **`Download ZIP`** 선택
3. 압축 해제 후 폴더로 이동

**방법 B: Git 클론**

```bash
git clone https://github.com/wkuMyeungsu/veda-test-c.git
cd veda-test-c
```

---

### 2단계 — 로컬 서버 실행

> ⚠️ **반드시 로컬 서버가 필요합니다.**  
> 파일을 그냥 더블클릭(`file://`)하면 JSON 로딩이 차단되어 문제가 표시되지 않습니다.

#### VS Code를 사용하는 경우 (가장 쉬운 방법)

1. VS Code에서 폴더 열기
2. 확장(Extension) 탭(`Ctrl+Shift+X`)에서 **`Live Server`** 검색 후 설치
3. `index.html` 파일을 열고 우하단 **`Go Live`** 버튼 클릭
4. 브라우저가 자동으로 열립니다 (`http://127.0.0.1:5500`)

#### Python을 사용하는 경우

> Python이 없다면 먼저 설치하세요 → **[Python 공식 다운로드](https://www.python.org/downloads/)**  
> 설치 시 **`Add Python to PATH`** 체크박스를 반드시 선택하세요!

설치 후 터미널(명령 프롬프트)을 열고 폴더로 이동한 뒤 실행합니다.

```bash
# 압축 해제한 폴더 안에서 실행
python -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속  
종료하려면 터미널에서 `Ctrl + C`

> **터미널을 처음 쓴다면:**  
> Windows — 탐색기에서 폴더 열고 주소창에 `cmd` 입력 후 Enter  
> Mac — 폴더에서 우클릭 → `폴더에서 새 터미널 열기`

#### Node.js를 사용하는 경우

> Node.js가 없다면 먼저 설치하세요 → **[Node.js 공식 다운로드](https://nodejs.org/ko)**  
> LTS(안정화) 버전을 선택하여 설치하세요.

```bash
# 압축 해제한 폴더 안에서 실행
npx serve .
```

터미널에 표시되는 주소(`http://localhost:3000` 등)로 브라우저 접속  
종료하려면 터미널에서 `Ctrl + C`

---

### 3단계 — 결과 저장 폴더 연결 (선택사항)

시험 결과를 `.txt` 파일로 저장하려면 처음 한 번만 폴더를 지정해야 합니다.

1. 시작 화면 상단 **`결과 저장 폴더`** 카드에서 **`폴더 선택`** 클릭
2. 프로젝트 폴더 안의 `results/` 폴더 선택 (또는 원하는 폴더)
3. 이후 시험이 끝나면 자동으로 그 폴더에 저장됩니다

> 폴더를 지정하지 않아도 시험은 정상 진행됩니다. 결과 페이지에서 수동으로 다운로드할 수 있습니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **20문제 자동 출제** | O/X 4 + 객관식 6 + 주관식 10, 매번 무작위 |
| **자동 채점** | O/X · 객관식 즉시 채점 |
| **자가 채점** | 주관식은 모범답안 확인 후 ✔맞음 / ✘틀림 직접 선택 |
| **정답 토글** | 문제마다 정답·해설 보기/숨기기 |
| **메모 기능** | 문제별 노트 작성 · 저장 · 삭제 |
| **문제 편집** | 시험 중 문제 텍스트 수정 가능 |
| **패스** | 모르는 문제는 패스 버튼으로 건너뛰기 (틀림 처리) |
| **챕터별 결과** | 어느 챕터에서 몇 문제 틀렸는지 요약 |
| **시험 기록** | 결과 폴더의 `.txt` 파일 자동 읽기, 회차별 상세 보기 |
| **문제 관리** | 전체 문제 조회·추가·수정·삭제 (`manage.html`) |
| **합격 기준** | 12문제 이상 (60점+) → PASS |

---

## 화면 구성

```
index.html   시작 화면 (결과 폴더 설정, 시험 시작, 문제 관리)
exam.html    시험 진행 화면 (진행바, 이전/다음, 정답 토글, 메모, 패스)
result.html  채점 결과 + 시험 기록
manage.html  문제 관리 (조회·추가·수정·삭제, 15개씩 페이지네이션)
```

---

## 문제 파일 구조

```
questions/
├── manifest.json          ← 로드할 파일 목록 (여기에 추가하면 자동 인식)
├── ox.json                ← O/X 문제
├── multiple.json          ← 객관식 5지선다
├── subjective.json        ← 주관식
├── cpp_questions.json     ← C++ 전용 문제
└── c_lang_questions.json  ← C언어 교재(CH1~CH12) 문제 60개
```

### 새 문제 파일 추가하기

1. `questions/` 폴더에 JSON 파일 생성
2. `questions/manifest.json`에 파일명 추가

```json
["ox.json", "multiple.json", "subjective.json", "cpp_questions.json", "새파일.json"]
```

앱이 각 문제의 `"type"` 필드를 보고 자동으로 분류합니다.

---

## 문제 JSON 형식

### O/X 문제
```json
{
  "id": "ox_001",
  "chapter": "CH8 배열과 문자열",
  "type": "ox",
  "question": "C언어에서 배열의 인덱스는 0부터 시작한다.",
  "answer": true,
  "explanation": "C/C++ 배열은 0-indexed이다."
}
```

### 객관식 (5지선다)
```json
{
  "id": "mc_001",
  "chapter": "CH4 콘솔 입출력과 연산자",
  "type": "multiple",
  "question": "printf()에서 정수를 출력할 때 사용하는 포맷 지정자는?",
  "options": ["%c", "%f", "%d", "%s", "%p"],
  "answer": 2,
  "explanation": "%d는 부호 있는 10진 정수를 출력한다."
}
```
> `"answer"`는 0부터 시작하는 인덱스입니다. (`2` → 세 번째 선택지 `%d`)

### 주관식
```json
{
  "id": "sub_001",
  "chapter": "CH8 배열과 문자열",
  "type": "subjective",
  "subtype": "code_blank",
  "question": "배열의 세 번째 원소를 출력하려면 빈칸에 무엇을 넣어야 하는가?",
  "code": "int arr[5] = {1, 2, 3, 4, 5};\nprintf(\"%d\", arr[___]);",
  "answer": "2",
  "explanation": "배열 인덱스는 0부터 시작하므로 세 번째 원소는 인덱스 2이다."
}
```

| `subtype` | 설명 |
|-----------|------|
| `code_blank` | 코드 빈칸 채우기 |
| `code_result` | 코드 실행 결과 작성 |
| `concept` | 개념 서술 |

### 단답형
```json
{
  "id": "short_001",
  "chapter": "CH1 네임스페이스",
  "type": "short",
  "question": "C++에서 이름 충돌을 방지하기 위해 사용되는 논리적 영역을 무엇이라 하는가?",
  "answer": "네임스페이스(namespace)",
  "explanation": "namespace 키워드로 동일한 이름의 식별자들을 구분합니다."
}
```

---

## 문제 유형 분류 규칙

| `"type"` 값 | 출제 풀 | 시험 출제 수 |
|---|---|---|
| `"ox"` | O/X 풀 | 4문제 |
| `"multiple"` | 객관식 풀 | 6문제 |
| `"subjective"` | 주관식 풀 | 10문제 (합산) |
| `"short"` | 주관식 풀 | ↑ 동일 |

---

## 채점 방식

```
1. O/X · 객관식  → 자동 채점
2. 주관식 · 단답형 → 모범답안 확인 후 ✔맞음 / ✘틀림 직접 선택 (필수)
3. 오버라이드 → 자동 채점 결과를 덮어씀
4. 최종 점수 = 정답 문제 수 × 5점
5. 12문제 이상 (60점+) → PASS
```

---

## 프로젝트 구조

```
veda-test-c/
├── index.html             시작 화면
├── exam.html              시험 진행 화면
├── result.html            결과 및 기록 화면
├── manage.html            문제 관리 화면
├── app.js                 전체 로직 (문제 로딩·채점·저장)
├── style.css              Google Forms 스타일 UI
├── questions/
│   ├── manifest.json      로드할 파일 목록
│   ├── ox.json
│   ├── multiple.json
│   ├── subjective.json
│   ├── cpp_questions.json
│   └── c_lang_questions.json
├── results/               시험 결과 .txt 저장 폴더
└── docs/
    ├── plan.md            프로젝트 기획 문서
    └── question_history.txt  출제 이력 (중복 방지용)
```

---

## 문제 추가 시 주의사항

새 문제를 추가할 때는 `docs/question_history.txt`를 먼저 확인해 중복 출제를 방지하세요.

```
# 형식
ID | 유형 | 핵심주제 | 생성일
```

---

## 라이선스

MIT
