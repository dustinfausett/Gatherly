import {expect} from '@playwright/test';
export const messageOptions=page=>page.getByRole('dialog',{name:'Message options',exact:true});
export async function openMessageOptions(page,message){
 await message.focus();await message.press('Enter');const dialog=messageOptions(page);await expect(dialog).toBeVisible();return dialog;
}
export async function holdMessage(page,message,touch=false){
 await message.scrollIntoViewIfNeeded();const box=await message.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 if(touch){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await expect(messageOptions(page)).toBeVisible();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else{await page.mouse.move(x,y);await page.mouse.down();await expect(messageOptions(page)).toBeVisible();await page.mouse.up();}
 return messageOptions(page);
}
export async function chooseMessageAction(page,message,name){const dialog=await openMessageOptions(page,message);await dialog.getByRole('button',{name,exact:true}).click();}
