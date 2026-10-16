import type {ChannelAgreement} from '../../features/channels/types';
import type {BookingSourceConfiguration} from '../../features/configuration/types';
export interface SourceDto {id:string;source_id:string;label:string;initial_label?:string|null;enabled:boolean;classification?:BookingSourceConfiguration['classification'];reference_required?:boolean;notes?:string;version?:number;agreement_version?:number}
export function sourceLabel(id:string,captured:string|null|undefined,sources:SourceDto[]){const source=sources.find(s=>s.id===id);return captured??source?.initial_label??source?.label??'Direct';}
export interface AgreementDto {id:string;company_id:string;source_id:string;revision:number;version:number;effective_from:string;effective_to:string|null;status:ChannelAgreement['status'];currency:'PHP';terms:Pick<ChannelAgreement,'pricing'|'commission'|'payment'|'settlement'>;created_at:string;actor:string}
export function presentSource(source:SourceDto):BookingSourceConfiguration{return {id:source.id,label:source.label,enabled:source.enabled,classification:source.classification??'direct',referenceRequired:source.reference_required??false,notes:source.notes??'',serverVersion:source.version,agreementVersion:source.agreement_version??0};}
export function presentAgreement(a:AgreementDto):ChannelAgreement{return {id:a.id,channelId:a.source_id,version:a.revision,serverVersion:a.version,effectiveFrom:a.effective_from,effectiveTo:a.effective_to??undefined,status:a.status,currency:a.currency,...a.terms};}
export function sourceInput(source:BookingSourceConfiguration,isNew:boolean){return {label:source.label,classification:source.classification??'direct',enabled:source.enabled,reference_required:source.referenceRequired??false,notes:source.notes??'',...(!isNew?{expected_version:source.serverVersion}: {})};}
export function agreementInput(a:ChannelAgreement,source:BookingSourceConfiguration,isNew:boolean){
 if(a.currency!=='PHP')throw new Error('Persistent agreements currently support PHP only.');
 if(!source.serverVersion)throw new Error('Reload and review this source before saving.');
 return {expected_source_version:source.serverVersion,expected_agreement_version:source.agreementVersion??0,effective_from:a.effectiveFrom,effective_to:a.effectiveTo??null,status:a.status,currency:a.currency,terms:{pricing:a.pricing,commission:a.commission,payment:a.payment,settlement:a.settlement},...(!isNew?{expected_version:a.serverVersion}: {})};
}
