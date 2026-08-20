// ============================================================
//  Campaigns (sequences): CRUD, contact enrollment, recommended sequence.
// ============================================================
import * as repo from '../db/repo.js';
import type { Campaign, CampaignOverrides, CampaignStatus, Step } from '../types.js';

export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  steps: Step[];
  settings: CampaignOverrides | null;
  counts: Record<string, number>;
  created_at: number;
  updated_at: number;
}

function view(c: Campaign): CampaignView {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    steps: JSON.parse(c.steps) as Step[],
    settings: c.settings ? (JSON.parse(c.settings) as CampaignOverrides) : null,
    counts: repo.enrollmentStatusCounts(c.id),
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/**
 * The recommended sequence for a FREE account, the one documented in the README:
 *
 *   visit profile → wait 1 day → connect WITHOUT a note
 *   → wait for acceptance → first personalized message
 *
 * The personalized note does NOT go in the invite: free accounts can attach one
 * to just 5 invites a month. Personalization lives in the first message after
 * acceptance, where it costs nothing.
 */
export function recommendedSteps(opts: { firstMessage?: string; waitAcceptDays?: number } = {}): Step[] {
  const steps: Step[] = [
    { type: 'visit' },
    { type: 'wait', days: 1 },
    { type: 'connect' },
    { type: 'wait_accept', maxDays: opts.waitAcceptDays ?? 14 },
  ];
  if (opts.firstMessage && opts.firstMessage.trim()) {
    steps.push({ type: 'message', text: opts.firstMessage.trim() });
  }
  return steps;
}

export function createCampaign(name: string, steps: Step[], settings?: CampaignOverrides): CampaignView {
  return view(repo.createCampaign(name, steps, settings));
}

export function listCampaigns(): CampaignView[] {
  return repo.listCampaigns().map(view);
}

export function getCampaign(id: string): CampaignView {
  const c = repo.getCampaign(id);
  if (!c) throw new Error(`campaign "${id}" not found`);
  return view(c);
}

export function updateCampaign(
  id: string,
  patch: { name?: string; steps?: Step[]; settings?: CampaignOverrides | null },
): CampaignView {
  repo.updateCampaign(id, patch);
  return getCampaign(id);
}

export function setCampaignStatus(id: string, status: CampaignStatus): CampaignView {
  if (!repo.getCampaign(id)) throw new Error(`campaign "${id}" not found`);
  repo.setCampaignStatus(id, status);
  return getCampaign(id);
}

export function deleteCampaign(id: string): void {
  if (!repo.getCampaign(id)) throw new Error(`campaign "${id}" not found`);
  repo.deleteCampaign(id);
}

export function enrollContacts(campaignId: string, contactIds: string[]): { enrolled: number; requested: number } {
  if (!repo.getCampaign(campaignId)) throw new Error(`campaign "${campaignId}" not found`);
  const enrolled = repo.enrollContacts(campaignId, contactIds);
  return { enrolled, requested: contactIds.length };
}
