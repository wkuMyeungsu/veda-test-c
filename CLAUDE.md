# Claude 작업 규칙 — veda 테스트 준비

## 문제 생성 시 챕터명 규칙 (엄격 준수)

새 문제를 만들 때 반드시 아래 표의 **정확한 문자열**을 `"chapter"` 값으로 사용한다.
오타, 공백 누락, 번호 포맷 불일치(CH1 vs CH01 등)는 허용하지 않는다.

---

### C++ 챕터 (CH01 ~ CH10)

| chapter 값 | 주요 내용 |
|---|---|
| `CH01 C++ 기초` | 네임스페이스, inline, new/delete, extern "C", 힙 메모리 |
| `CH02 예외처리` | try/catch/throw, 스택 풀기(Stack Unwinding) |
| `CH03 클래스와 객체` | 클래스 설계, 접근지정자, 캡슐화, 생성자/소멸자 |
| `CH04 객체포인터와 객체배열` | 객체 포인터, 객체 배열, this 포인터 응용 |
| `CH05 참조와 복사생성자` | 참조자(&), 얕은/깊은 복사, rvalue 참조(&&) |
| `CH06 함수중복과 const 정적함수` | 오버로딩, 디폴트 매개변수, const 함수, static 함수 |
| `CH07 연산자 오버로딩과 입출력스트림` | operator 오버로딩, cin/cout, 스트림 연산자 |
| `CH08 상속과 다형성` | 상속, protected, 가상함수, 순수가상함수, 추상클래스, 업캐스팅 |
| `CH09 파일입출력` | ifstream/ofstream, ios 플래그 |
| `CH10 템플릿` | 함수/클래스 템플릿, 특수화(Specialization) |

---

### C언어 챕터 (C언어 CH01 ~ C언어 CH12)

| chapter 값 | 주요 내용 |
|---|---|
| `C언어 CH01 C 언어 개요와 프로그램 작성` | C언어 역사, 컴파일 과정, 기본 프로그램 구조 |
| `C언어 CH02 C 언어 시작하기` | 수의 표현(2진수/16진수), 기본 입출력 |
| `C언어 CH03 기본 자료형과 변수` | int/char/float/double, sizeof, const, 변수명 규칙 |
| `C언어 CH04 콘솔 입출력과 연산자` | printf/scanf, 포맷 지정자, 산술/논리/비교/삼항 연산자 |
| `C언어 CH05 제어문` | if/else, switch, for, while, do-while, break, continue |
| `C언어 CH06 함수` | 함수 선언·정의, 매개변수, 반환값, 재귀 |
| `C언어 CH07 기억 클래스` | auto, static, extern, register, 스코프 |
| `C언어 CH08 배열과 문자열` | 1차원 배열, 문자열, strcpy/strlen/strcmp/strcat, NULL 종료 |
| `C언어 CH09 문자열 처리함수와 다차원 배열` | 2차원 배열, 문자열 처리 함수 심화 |
| `C언어 CH10 포인터` | 포인터 선언/역참조, 포인터 연산, 동적 메모리(malloc/calloc/realloc/free), 이중 포인터 |
| `C언어 CH11 구조체` | struct 선언, 멤버 접근, 구조체 배열 |
| `C언어 CH12 파일입출력` | fopen/fclose, fprintf/fscanf, fread/fwrite |

---

## 문제 생성 추가 규칙

1. **중복 방지**: 생성 전 `docs/question_history.txt` 를 읽어 기존 ID·핵심주제와 겹치지 않는지 확인한다.
2. **ID 형식**
   - C++ 문제: `cpp_NNN` (세 자리 숫자)
   - C언어 문제: `c_NNN`
   - O/X: `ox_NNN`, 객관식: `mc_NNN`, 주관식: `sub_NNN`
3. **type 값**: `"ox"` / `"multiple"` / `"subjective"` / `"short"` 중 하나
4. **answer 값**
   - ox: `true` / `false`
   - multiple: 0-based 인덱스 정수
   - subjective/short: 문자열
5. **explanation**: 반드시 포함. 왜 그 답인지 근거 명시.
6. **생성 후**: `docs/question_history.txt` 에 새 항목 추가 (`ID | 유형 | 핵심주제 | 날짜`).
