// File.type can be empty or image/jpg for camera files. The signature determines
// the canonical request type; the server still validates the complete image.
export async function prepareUploadFile(file:File):Promise<File>{
 if(!file.size||file.size>30_000_000)throw Error('画像は30 MB以下にしてください');
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
 let mime='';
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';
 else if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))mime='image/png';
 else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
 if(!mime)throw Error('PNG・JPEG・WebPを選んでください');
 return file.type===mime?file:new File([file],file.name,{type:mime,lastModified:file.lastModified});
}
