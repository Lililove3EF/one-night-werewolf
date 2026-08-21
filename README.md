# 한밤의 늑대인간 — Firebase + GitHub Pages MVP

## 들어있는 파일
- `index.html`
- `style.css`
- `roles.js`
- `game.js`
- `database.rules.json`
- `firebase.example.js`
- `.nojekyll`
- `README.md`

네가 이미 만든 `firebase.js`는 이 폴더에 직접 추가하면 됩니다.

## firebase.js 필수 export
`game.js`는 아래 3개를 기대합니다.

```js
export const auth = getAuth(app);
export const db = getDatabase(app);
export async function ensureLogin() { ... }
```

현재 Firebase 공식 브라우저 ESM 예제 버전 `12.17.0` 기준입니다. 기존 파일이 다르면 `firebase.example.js`와 맞춰주세요.

## Firebase 설정
1. Authentication → Sign-in method → Anonymous → Enable
2. Realtime Database 생성
3. Realtime Database → Rules 탭
4. `database.rules.json` 전체 내용을 복사해서 붙여넣기
5. Publish

## GitHub Pages
공개 저장소 루트에 아래 파일을 올립니다.

```text
index.html
style.css
roles.js
game.js
firebase.js
.nojekyll
```

그 다음:

`Settings → Pages → Deploy from a branch → main → /(root)`

친구는 생성된 `https://아이디.github.io/저장소명/` 주소만 열면 됩니다. 친구 계정은 필요 없습니다.

## 현재 구현
- 3~10명 방 생성/참가
- 방장 역할 카드 구성
- 플레이어+3장 배분
- 본판 역할: 마을주민, 늑대인간, 하수인, 프리메이슨, 예언자, 강도, 말썽쟁이, 주정뱅이, 불면증환자, 무두장이, 사냥꾼, 도플갱어
- 도플갱어 복제 및 즉시/후속 행동
- 밤 카드 확인/교환
- 낮 토론 타이머
- 최종 투표
- 동률/전원 1표 처리
- 사냥꾼 추가 사망
- 마을/늑대/무두장이 승리 판정
- 재경기

## 무료 MVP의 보안 한계
방장 브라우저가 게임 엔진입니다. 일반 플레이어는 Security Rules 때문에 다른 사람의 비밀 역할을 읽을 수 없지만, 방장은 개발자 도구로 `engine` 데이터를 보면 전체 카드를 확인할 수 있습니다.

친구끼리 방장을 신뢰하는 무료 MVP용 구조입니다.
