export type GeneralInfoInputType = "text" | "image" | "video" | "url";

export type GeneralInfoFileType = "none" | "image" | "video";

export interface GeneralInfoMediaItem {
  id: number;
  name: string;
  type: GeneralInfoFileType;
  preview: string;
  storagePath?: string;
  /** @deprecated fileUrl 사용 권장 */
  url?: string;
  fileUrl?: string;
  memo?: string;
}

export type GeneralInfoFactCheckStatus =
  | "확인 전"
  | "확인 필요"
  | "확인 완료"
  | "오류 가능성";

export interface GeneralInfoItem {
  id: number;
  title: string;
  inputTypes: GeneralInfoInputType[];
  text: string;
  sourceUrl?: string;
  fileName?: string;
  filePreview?: string;
  mediaItems?: GeneralInfoMediaItem[];
  primaryCategory: string;
  secondaryCategory: string;
  thirdCategory: string;
  keywords: string[];
  factCheckStatus: GeneralInfoFactCheckStatus;
  factCheckSummary: string;
  summary: string;
  extraNote?: string;
  formattedTextHtml?: string;
  confirmed: boolean;
  createdAt: string;
  isPinned?: boolean;
}

export interface GeneralInfoDraft {
  title: string;
  text: string;
  sourceUrl: string;
  fileName: string;
  filePreview: string;
  storagePath?: string;
  url?: string;
  fileType: GeneralInfoFileType;
  mediaItems: GeneralInfoMediaItem[];
  primaryCategory: string;
  secondaryCategory: string;
  thirdCategory: string;
  keywords: string[];
  summary: string;
  factCheckStatus: GeneralInfoFactCheckStatus;
  factCheckSummary: string;
  formattedTextHtml?: string;
  isPinned?: boolean;
}
