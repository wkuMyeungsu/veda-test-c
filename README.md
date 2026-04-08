# C/C++ 이론 시험 📝

C/C++ 수업 내용을 기반으로 문제은행에서 자동 출제하는 **로컬 시험 웹사이트**입니다.  
Google Forms 스타일 UI · 자동채점 · 자가채점 · 챕터별 결과 분석 · 시험 기록 관리

---

## 화면 미리보기

| 시작 화면 | 시험 화면 | 결과 화면 |
|-----------|-----------|-----------|
| 문제 구성 안내 | 진행바 + 정답 토글 | 챕터별 약점 분석 |

---

## 기능

- **20문제 자동 출제** — 문제은행에서 무작위 추출 (O/X 4 + 객관식 6 + 주관식 10)
- **자동 채점** — O/X, 객관식은 즉시 채점
- **자가 채점** — 주관식은 모범답안 확인 후 본인이 ✔맞음 / ✘틀림 선택
- **정답 토글** — 문제마다 정답·해설 보기/숨기기
- **챕터별 결과** — 어느 챕터에서 몇 문제 틀렸는지 요약
- **시험 기록 관리** — localStorage 자동 저장, 회차별 상세 내용 펼치기
- **결과 다운로드** — N회차 시험결과.txt 파일로 저장
- **합격 기준** — 12문제 이상 (60점 이상) → PASS

---

## 시작하기

### 1. 저장소 클론

```bash
git clone https://github.com/YOUR_USERNAME/c-cpp-exam.git
cd c-cpp-exam
```

### 2. 로컬 서버 실행

> ⚠️ `fetch()`로 JSON을 읽으려면 로컬 서버가 필요합니다. `file://` 프로토콜은 CORS 차단됩니다.

**방법 A — Python (별도 설치 불필요)**
```bash
python -m http.server 8000
```
브라우저에서 `http://localhost:8000` 접속

**방법 B — VS Code Live Server 확장**
1. VS Code 확장에서 `Live Server` 설치
2. `index.html` 열고 우하단 `Go Live` 클릭

---

## 문제 파일 구조

```
questions/
├── manifest.json        ← 로드할 파일 목록 (여기에 추가하면 자동 인식)
├── ox.json              ← O/X 문제
├── multiple.json        ← 객관식 5지선다
├── subjective.json      ← 주관식 (code_blank / code_result / concept)
└── cpp_questions.json   ← C++ 전용 문제 50개
```

### 새 문제 파일 추가 방법

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
  "id": "cpp_012",
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
c-cpp-exam/
├── index.html           시작 화면
├── exam.html            시험 진행 화면
├── result.html          결과 및 기록 화면
├── app.js               전체 로직 (문제 로딩·채점·저장)
├── style.css            Google Forms 스타일 UI
├── questions/
│   ├── manifest.json    로드할 파일 목록
│   ├── ox.json
│   ├── multiple.json
│   ├── subjective.json
│   └── cpp_questions.json
├── results/             시험 결과 .txt 저장 폴더 (git 제외)
└── docs/
    ├── plan.md          프로젝트 기획 문서
    └── question_history.txt  출제 이력 (중복 방지용)
```

---

## 기여 / 문제 추가

새 문제를 추가할 때는 `docs/question_history.txt`를 먼저 확인해 중복 출제를 방지하세요.

```
# 형식
ID | 유형 | 핵심주제 | 생성일
```

---

## 라이선스

MIT
