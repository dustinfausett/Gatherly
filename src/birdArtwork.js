import {HOLIDAY_ART} from './holidayArtwork';
// Bounds follow each complete pose, keeping neighboring feathers and feet out
// of the viewport. These are display crops; the generated PNGs stay intact.
const sheets = {
  meadow: [
    [[48,71,273,349],[337,54,600,326],[622,90,938,338],[961,77,1236,344]],
    [[44,369,274,646],[337,349,601,623],[624,383,938,634],[962,372,1237,641]],
    [[44,667,273,939],[338,641,602,917],[623,677,938,932],[964,671,1237,938]],
    [[42,949,275,1225],[336,932,602,1211],[622,963,936,1223],[961,964,1236,1225]],
  ],
  canopy: [
    [[36,62,260,346],[327,41,599,322],[616,82,931,336],[966,60,1244,336]],
    [[32,364,260,645],[329,345,599,620],[618,380,933,635],[966,366,1246,641]],
    [[39,661,269,923],[325,643,606,897],[622,671,940,911],[971,662,1240,916]],
    [[42,930,268,1226],[328,913,598,1208],[624,942,937,1217],[972,920,1243,1222]],
  ],
  woodland: [
    [[23,57,269,329],[326,37,615,313],[634,80,937,321],[966,59,1245,322]],
    [[25,374,272,622],[322,342,615,606],[623,391,942,624],[970,376,1241,619]],
    [[24,639,272,929],[327,627,609,918],[625,649,940,930],[967,641,1239,932]],
    [[31,980,315,1211],[329,948,667,1198],[626,1001,963,1205],[974,974,1246,1219]],
  ],
};
export function birdFrame(bird, pose) {
  const col = {perched:0,takeoff:1,up:1,down:2,glide:2,landing:3}[pose] ?? 0;
  const [left,top,right,bottom] = HOLIDAY_ART[bird.id]?.frames[col] || sheets[bird.collection][bird.row][col];
  // The long hummingbird beak reaches into its neighbor's square; keep its
  // outline while excluding the neighboring wing and beak respectively.
  const clip = bird.id==='goose' ? (col===1?'M414 109H860V320H814V612H414Z':col===2?'M860 200H1254V660H810V330H860Z':null) : bird.id !== 'hummingbird' ? null : col === 1
    ? 'M326 945H626V1008H670V1040H626V1201H326Z'
    : col === 2 ? 'M670 998H966V1208H623V1044H670Z' : null;
  return { src:HOLIDAY_ART[bird.id]?.src || `/brand/birds/${bird.collection}.png`, x:left-2, y:top-2, width:right-left+4, height:bottom-top+4, clip };
}
