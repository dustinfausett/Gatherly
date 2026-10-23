import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import './style.css';

const menu=document.querySelector('.menu-toggle'),navigation=document.querySelector('#site-navigation');
function closeMenu(){menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open menu');navigation.classList.remove('is-open');}
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open ? 'Close menu' : 'Open menu');navigation.classList.toggle('is-open',open);});
navigation.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});

const scenes={
  schools:{tree:'The Maplewood School',caption:'Good things grow here.',pinned:'School announcements',branch:'Classroom connections',first:'Mrs. Taylor’s class',second:'Field trip crew',kicker:'A LITTLE LESS “DID YOU SEE THE EMAIL?”',title:'From the classroom\nto the carpool.',description:'Keep school announcements, class conversations, and volunteer plans in their own Nests. Parents can join what matters to their family.',tags:['Class updates','Parent connections','Volunteer plans']},
  churches:{tree:'Maple Meadow Church',caption:'A place to grow together.',pinned:'Sunday announcements',branch:'Community & care',first:'Small group connections',second:'This week’s volunteers',kicker:'A LITTLE MORE LIFE BETWEEN SUNDAYS',title:'A community beyond\nthe Sunday gathering.',description:'Give ministries, small groups, and volunteer teams a place to stay connected. Keep church-wide announcements in reach without mixing every conversation together.',tags:['Ministry teams','Small groups','Serving together']},
  families:{tree:'The Fausett Family',caption:'All your favorite people.',pinned:'The whole family',branch:'Our next get-together',first:'Reunion plans',second:'Who’s bringing dessert?',kicker:'A LITTLE CLOSER, EVEN FROM FAR AWAY',title:'For the everyday.\nAnd the “remember when?”',description:'Keep the whole family in one Tree, with smaller Nests for reunion plans, shared photos, or the cousins’ running conversation.',tags:['Family updates','Reunion plans','Everyday moments']},
};
document.querySelectorAll('[data-scene]').forEach(button=>button.addEventListener('click',()=>{
  const scene=scenes[button.dataset.scene];
  for(const key of ['tree','caption','pinned','branch','first','second'])document.querySelector(`#demo-${key}`).textContent=scene[key];
  for(const key of ['kicker','title','description'])document.querySelector(`#audience-${key}`).textContent=scene[key];
  document.querySelector('#audience-tags').replaceChildren(...scene.tags.map(tag=>{const span=document.createElement('span');span.textContent=tag;return span;}));
  document.querySelectorAll('[data-scene]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
}));

// Direct links remain usable if the config request is unavailable. No email,
// analytics, payment form or visitor data collection is added to the website.
fetch('/api/site-config',{credentials:'omit',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Site settings unavailable');return r.json();}).then(config=>{
  for(const [selector,value] of [['[data-app-link]',config.appUrl],['[data-signup-link]',config.signupUrl]]){
    const url=new URL(value);if(!['https:','http:'].includes(url.protocol) || (location.protocol==='https:' && url.protocol!=='https:'))continue;
    document.querySelectorAll(selector).forEach(link=>{link.href=url.href;});
  }
}).catch(()=>{});
document.querySelector('#copyright-year').textContent=String(new Date().getFullYear());
function openLinkedQuestion(){const target=document.getElementById(location.hash.slice(1));if(target?.tagName==='DETAILS')target.open=true;}
addEventListener('hashchange',openLinkedQuestion);openLinkedQuestion();
