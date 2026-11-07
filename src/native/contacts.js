import {Contacts} from '@capacitor-community/contacts';
export async function pickPhoneContact(){const result=await Contacts.pickContact({projection:{name:true,phones:true}}),c=result.contact;if(!c)return [];return [{name:[c.name?.display||[c.name?.given,c.name?.family].filter(Boolean).join(' ')||'Phone contact'],tel:(c.phones||[]).map(p=>p.number).filter(Boolean)}];}
