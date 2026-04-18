import type { Agent, Issue, IssueComment } from "@paperclipai/shared";
import { api } from "./client";

export type ConferenceRoomTargetResponse = {
  target: Agent | null;
  label: string | null;
};

export type ConferenceRoomChat = Issue & {
  latestComment?: IssueComment | null;
};

export type CreateConferenceRoomChatResponse = {
  issue: Issue;
  comment: IssueComment | null;
  target: Agent;
  label: string;
};

export const conferenceRoomApi = {
  target: (companyId: string) =>
    api.get<ConferenceRoomTargetResponse>(`/companies/${companyId}/conference-room/target`),
  chats: (companyId: string, targetAgentId?: string | null) => {
    const params = new URLSearchParams();
    if (targetAgentId) params.set("targetAgentId", targetAgentId);
    const qs = params.toString();
    return api.get<ConferenceRoomChat[]>(`/companies/${companyId}/conference-room/chats${qs ? `?${qs}` : ""}`);
  },
  createChat: (companyId: string, data: { targetAgentId?: string | null; initialBody: string }) =>
    api.post<CreateConferenceRoomChatResponse>(`/companies/${companyId}/conference-room/chats`, data),
};
