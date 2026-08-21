export const ROLE_DEFS = {
  villager:{label:'마을주민',emoji:'🧑‍🌾',max:3,desc:'밤 행동 없음'},
  werewolf:{label:'늑대인간',emoji:'🐺',max:2,desc:'다른 늑대를 확인. 혼자면 중앙 1장 확인'},
  minion:{label:'하수인',emoji:'🕯️',max:1,desc:'늑대인간을 확인'},
  mason:{label:'프리메이슨',emoji:'🧱',max:2,desc:'다른 프리메이슨을 확인'},
  seer:{label:'예언자',emoji:'🔮',max:1,desc:'다른 사람 1장 또는 중앙 2장 확인'},
  robber:{label:'강도',emoji:'🦹',max:1,desc:'다른 사람과 교환 후 새 카드 확인'},
  troublemaker:{label:'말썽쟁이',emoji:'🃏',max:1,desc:'다른 두 사람의 카드 교환'},
  drunk:{label:'주정뱅이',emoji:'🍺',max:1,desc:'중앙 1장과 강제 교환, 새 카드 못 봄'},
  insomniac:{label:'불면증환자',emoji:'👁️',max:1,desc:'밤 마지막에 현재 자기 카드 확인'},
  tanner:{label:'무두장이',emoji:'🪵',max:1,desc:'자신이 죽으면 승리'},
  hunter:{label:'사냥꾼',emoji:'🏹',max:1,desc:'죽으면 자신이 투표한 사람도 사망'},
  doppelganger:{label:'도플갱어',emoji:'🪞',max:1,desc:'다른 사람 직업을 복제'}
};
export const NIGHT_PHASES=['doppelganger','doppel_minion','werewolf','minion','mason','seer','robber','troublemaker','drunk','insomniac','doppel_insomniac'];
export const roleLabel=r=>ROLE_DEFS[r]?.label??r??'?';
export const roleEmoji=r=>ROLE_DEFS[r]?.emoji??'❓';
export function countRoles(roles=[]){return roles.reduce((a,r)=>((a[r]=(a[r]??0)+1),a),{});}
export function recommendedRoles(n){
  n=Number(n);
  if(n<=3)return ['werewolf','werewolf','seer','robber','troublemaker','villager'];
  if(n===4)return ['werewolf','werewolf','seer','robber','troublemaker','villager','villager'];
  if(n===5)return ['werewolf','werewolf','seer','robber','troublemaker','villager','villager','villager'];
  return ['werewolf','werewolf','seer','robber','troublemaker','minion','mason','mason','insomniac','tanner','hunter','drunk','doppelganger'].slice(0,n+3);
}
export function validateRoleDeck(roles,n){
  if(!Array.isArray(roles))return '역할 구성이 없습니다.';
  if(roles.length!==n+3)return `역할은 플레이어 수 + 3장, 총 ${n+3}장이어야 합니다.`;
  const c=countRoles(roles);
  for(const [r,v] of Object.entries(c)){if(!ROLE_DEFS[r])return `알 수 없는 역할: ${r}`;if(v>ROLE_DEFS[r].max)return `${ROLE_DEFS[r].label} 카드는 최대 ${ROLE_DEFS[r].max}장입니다.`;}
  return null;
}
