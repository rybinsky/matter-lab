/** Plan the final pass for the studio's integer PCM WAV. EBU loudness has no
 * useful integrated measurement for silence or clips shorter than its window.
 * Those paths retain the original mix gain; they never receive invented audio.
 */
export function finalAudioPlan(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
 if(bytes.byteLength<44||text(0,4)!=='RIFF'||text(8,4)!=='WAVE')throw Error('Expected a PCM WAV soundtrack');
 let format,pcm;
 for(let offset=12;offset+8<=bytes.byteLength;){
  const id=text(offset,4),length=v.getUint32(offset+4,true),start=offset+8;
  if(start+length>bytes.byteLength)throw Error('Truncated soundtrack WAV');
  if(id==='fmt '&&length>=16)format={encoding:v.getUint16(start,true),channels:v.getUint16(start+2,true),sampleRate:v.getUint32(start+4,true),bits:v.getUint16(start+14,true)};
  if(id==='data')pcm={start,length};offset=start+length+(length%2);
 }
 if(!format||!pcm||format.encoding!==1||format.bits!==16||!format.channels||!format.sampleRate||pcm.length%(2*format.channels))throw Error('Expected complete signed16-bit PCM soundtrack frames');
 const duration=pcm.length/(2*format.channels*format.sampleRate);let peak=0;
 for(let i=pcm.start;i<pcm.start+pcm.length;i+=2)peak=Math.max(peak,Math.abs(v.getInt16(i,true)));
 const reason=peak===0?'silent':duration<3?'short':'normal';
 return{duration,silent:peak===0,peak:peak/32768,reason,filterArgs:reason==='normal'?['-af','loudnorm=I=-16:TP=-1.5:LRA=9']:[]};
}
