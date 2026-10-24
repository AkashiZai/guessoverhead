/* โปรโตคอลระหว่าง client กับ server (ไม่มีข้อมูลตัวละครอยู่ในโค้ด client) */
export interface CharView{name:string;aliases:string[];hints:string[];cat?:string}
export interface Config{cats:string[];hard:boolean;seconds:number}
export type Status='play'|'won'|'gave';
export interface PlayerView{id:string;name:string;connected:boolean;status:Status;q:number;wrong:number;fin:number;ch?:CharView}
export type Phase='lobby'|'turn'|'reveal'|'final';
export interface View{
  code:string;me:string;host:string;phase:Phase;cfg:Config;
  cats:{id:string;name:string;count:number}[];
  players:PlayerView[];cur:string|null;remainingMs:number;
  notice:string;revealKind:'won'|'gave'|null;
  /** เลขลำดับตา เพิ่มทุกครั้งที่เปลี่ยนตา/เปลี่ยนสถานะ ใช้กันกดปุ่มค้างจากตาก่อนหน้า */
  turn:number;
}
export type Act='q+'|'q-'|'correct'|'wrong'|'give'|'skip'|'next';
export type ClientMsg=
  |{t:'create';name:string;token:string}
  |{t:'join';code:string;name:string;token:string}
  |{t:'leave'}
  |{t:'cfg';cfg:Config}
  |{t:'start'}
  |{t:'act';a:Act;turn:number}
  |{t:'again'}
  |{t:'lobby'};
export type ServerMsg={t:'view';view:View}|{t:'error';msg:string}|{t:'left'};
