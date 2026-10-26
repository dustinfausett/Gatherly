import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
export function normalizePhone(value,country='US'){
 if(!value)return null;
 if(typeof value!=='string' || value.length>80)throw new Error('Enter a valid phone number.');
 const phone=parsePhoneNumberFromString(value,country);if(!phone?.isValid())throw new Error('Enter a valid phone number with its country code.');return phone.number;
}
