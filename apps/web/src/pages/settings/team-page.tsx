import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
import { ConfirmDialog } from "@/components/confirm-dialog/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { StatusBadge, type BadgeTone } from "@/components/status-badge/status-badge";
import { useCapabilities } from "@/features/access/use-capabilities";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useToast } from "@/components/toast/toast";
import { InvitationCodeDialog } from "@/features/team/invitation-code-dialog";
import { InviteMemberDialog } from "@/features/team/invite-member-dialog";
import { teamErrorText } from "@/features/team/team-error-text";
import {
  TEMPLATE_ROLES,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  type CreatedInvitation,
  type TeamInvitation,
  type TeamMember,
} from "@/features/team/team-api";

const DASH = "—";

type ListState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: T[] };

/** `team.invite.role.<key>` for a known template/custom key; the raw value otherwise (legacy rows). */
function roleLabel(role: string, t: (key: TranslationKey) => string): string {
  if (role === "custom") return t("team.role.custom");
  if ((TEMPLATE_ROLES as readonly string[]).includes(role)) {
    return t(`team.invite.role.${role}` as TranslationKey);
  }
  return role;
}

function memberStatusTone(status: string): BadgeTone {
  return status === "active" ? "success" : "neutral";
}

function invitationStatusTone(status: string, expired: boolean): BadgeTone {
  if (status === "pending") return expired ? "destructive" : "warning";
  if (status === "accepted") return "success";
  if (status === "revoked") return "neutral";
  return "neutral";
}

function invitationStatusLabel(
  status: string,
  expired: boolean,
  t: (key: TranslationKey) => string,
): string {
  if (status === "pending" && expired) return t("team.status.expired");
  return t(`team.status.${status}` as TranslationKey);
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale);
}

/**
 * Team / Invitations / Custom Permissions (EPIC-15): the company's active
 * members, its invitations, and the "invite a member" flow (a fixed
 * permission template, or a one-off custom permission set). Viewing requires
 * `access.read`; inviting/revoking/removing requires `access.manage` — gated
 * client-side for UX only, the server enforces the same boundary (and the
 * additional Owner-invite rule) independently.
 */
export function TeamPage(): ReactNode {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { has } = useCapabilities();
  const toast = useToast();

  const companyId = user?.activeCompanyId ?? null;
  const activeMembership = user?.companies.find((c) => c.id === companyId);
  const isOwner = activeMembership?.role === "owner";
  const isManager = activeMembership?.role === "manager";
  const canManage = has({ permission: "access.manage" });

  const [members, setMembers] = useState<ListState<TeamMember>>({ kind: "loading" });
  const [invitations, setInvitations] = useState<ListState<TeamInvitation>>({ kind: "loading" });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState<CreatedInvitation | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [invitationToRevoke, setInvitationToRevoke] = useState<TeamInvitation | null>(null);

  const loadMembers = useCallback((id: string): void => {
    setMembers({ kind: "loading" });
    listMembers(id)
      .then(({ data }) => setMembers({ kind: "ready", items: data }))
      .catch(() => setMembers({ kind: "error" }));
  }, []);

  const loadInvitations = useCallback((id: string): void => {
    setInvitations({ kind: "loading" });
    listInvitations(id)
      .then(({ data }) => setInvitations({ kind: "ready", items: data }))
      .catch(() => setInvitations({ kind: "error" }));
  }, []);

  useEffect(() => {
    if (companyId === null) return;
    loadMembers(companyId);
    // Invitations are access.manage-gated server-side (unlike the member list,
    // which only needs access.read) — skip the call entirely for a caller who
    // doesn't hold it, instead of firing a request we know will 403.
    if (canManage) loadInvitations(companyId);
  }, [companyId, canManage, loadMembers, loadInvitations]);

  if (companyId === null) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
        <ErrorState description={t("team.error.noCompany")} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("team.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("team.subtitle")}</p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            {t("team.invite.button")}
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("team.members.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {members.kind === "loading" ? <LoadingState /> : null}
          {members.kind === "error" ? <ErrorState onRetry={() => loadMembers(companyId)} /> : null}
          {members.kind === "ready" && members.items.length === 0 ? (
            <EmptyState title={t("team.members.empty")} />
          ) : null}
          {members.kind === "ready" && members.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs uppercase text-muted-foreground">
                    <th className="px-2 py-2 text-start font-medium">
                      {t("team.members.column.name")}
                    </th>
                    <th className="px-2 py-2 text-start font-medium">
                      {t("team.members.column.email")}
                    </th>
                    <th className="px-2 py-2 text-start font-medium">
                      {t("team.members.column.role")}
                    </th>
                    <th className="px-2 py-2 text-start font-medium">
                      {t("team.members.column.status")}
                    </th>
                    <th className="px-2 py-2 text-start font-medium">
                      {t("team.members.column.joinedAt")}
                    </th>
                    {canManage ? <th className="px-2 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {members.items.map((member) => (
                    <tr key={member.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-2">{member.name ?? DASH}</td>
                      <td className="px-2 py-2 text-muted-foreground">{member.email}</td>
                      <td className="px-2 py-2">{roleLabel(member.role, t)}</td>
                      <td className="px-2 py-2">
                        <StatusBadge
                          label={t(`team.status.${member.status}` as TranslationKey)}
                          tone={memberStatusTone(member.status)}
                        />
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {formatDate(member.joinedAt, locale)}
                      </td>
                      {canManage ? (
                        <td className="px-2 py-2 text-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setMemberToRemove(member)}
                          >
                            {t("team.members.actions.remove")}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("team.invitations.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.kind === "loading" ? <LoadingState /> : null}
            {invitations.kind === "error" ? (
              <ErrorState onRetry={() => loadInvitations(companyId)} />
            ) : null}
            {invitations.kind === "ready" && invitations.items.length === 0 ? (
              <EmptyState title={t("team.invitations.empty")} />
            ) : null}
            {invitations.kind === "ready" && invitations.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-xs uppercase text-muted-foreground">
                      <th className="px-2 py-2 text-start font-medium">
                        {t("team.invitations.column.email")}
                      </th>
                      <th className="px-2 py-2 text-start font-medium">
                        {t("team.invitations.column.role")}
                      </th>
                      <th className="px-2 py-2 text-start font-medium">
                        {t("team.invitations.column.status")}
                      </th>
                      <th className="px-2 py-2 text-start font-medium">
                        {t("team.invitations.column.expiresAt")}
                      </th>
                      {canManage ? <th className="px-2 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.items.map((invitation) => {
                      const expired = new Date(invitation.expiresAt).getTime() <= Date.now();
                      return (
                        <tr key={invitation.id} className="border-b border-border last:border-0">
                          <td className="px-2 py-2">{invitation.email}</td>
                          <td className="px-2 py-2">{roleLabel(invitation.role, t)}</td>
                          <td className="px-2 py-2">
                            <StatusBadge
                              label={invitationStatusLabel(invitation.status, expired, t)}
                              tone={invitationStatusTone(invitation.status, expired)}
                            />
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {formatDate(invitation.expiresAt, locale)}
                          </td>
                          {canManage ? (
                            <td className="px-2 py-2 text-end">
                              {invitation.status === "pending" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setInvitationToRevoke(invitation)}
                                >
                                  {t("team.invitations.actions.revoke")}
                                </Button>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        companyId={companyId}
        isOwner={isOwner}
        isManager={isManager}
        onCreated={(invitation) => {
          setCreatedInvitation(invitation);
          loadInvitations(companyId);
        }}
      />

      <InvitationCodeDialog
        invitation={createdInvitation}
        onOpenChange={(open) => {
          if (!open) setCreatedInvitation(null);
        }}
      />

      <ConfirmDialog
        open={memberToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
        title={t("team.members.remove.confirmTitle")}
        description={t("team.members.remove.confirmDescription", {
          name: memberToRemove?.name ?? memberToRemove?.email ?? "",
        })}
        confirmLabel={t("team.members.remove.confirm")}
        cancelLabel={t("team.members.remove.cancel")}
        destructive
        onConfirm={async () => {
          if (memberToRemove === null) return;
          try {
            await removeMember(companyId, memberToRemove.id);
            toast.show(t("team.members.remove.success"), { variant: "success" });
            loadMembers(companyId);
          } catch (caught) {
            toast.show(teamErrorText(caught, t), { variant: "error" });
            throw caught;
          }
        }}
      />

      <ConfirmDialog
        open={invitationToRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setInvitationToRevoke(null);
        }}
        title={t("team.invitations.revoke.confirmTitle")}
        description={t("team.invitations.revoke.confirmDescription", {
          email: invitationToRevoke?.email ?? "",
        })}
        confirmLabel={t("team.invitations.revoke.confirm")}
        cancelLabel={t("team.invitations.revoke.cancel")}
        destructive
        onConfirm={async () => {
          if (invitationToRevoke === null) return;
          try {
            await revokeInvitation(companyId, invitationToRevoke.id);
            toast.show(t("team.invitations.revoke.success"), { variant: "success" });
            loadInvitations(companyId);
          } catch (caught) {
            toast.show(teamErrorText(caught, t), { variant: "error" });
            throw caught;
          }
        }}
      />
    </div>
  );
}
