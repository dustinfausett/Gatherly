import {parsePhoneNumberFromString} from 'libphonenumber-js/min';
export const isUsPhone=value=>typeof value==='string'&&parsePhoneNumberFromString(value)?.country==='US';
const basic=new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const extended=new Set(Array.from('\f^{}\\[~]|€'));
export function smsSegments(text){let units=0,unicode=false;for(const char of text){if(basic.has(char))units++;else if(extended.has(char))units+=2;else{unicode=true;break;}}if(unicode)units=text.length;const single=unicode?70:160,multi=unicode?67:153;return {encoding:unicode?'Unicode':'GSM-7',units,segments:units<=single?1:Math.ceil(units/multi)};}
export const SMS_DISCLOSURE_VERSION='2026-10-27-v1';
export const SMS_DISCLOSURE='Receive individual Churp texts from the sender and Tree named above, including messages with an invitation to join that Tree. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out of all texts from this Churp number. SMS consent is optional, not a condition of purchase, and separate from agreeing to the terms and privacy policy. This pilot is for adults 18 or older. SMS is not end-to-end encrypted.';
export const STOP_WORDS=new Set(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT']);
export const HELP_WORDS=new Set(['HELP','INFO','SUPPORT']);
