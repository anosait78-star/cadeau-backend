import { Lock, Plus, Search, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/auth/use-auth";
import { ConfirmDialog } from "@/components/confirm-dialog/confirm-dialog";
import { PageTitle } from "@/components/layout/page-title";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  getPermissionTemplates,
  listMemberPermissions,
  type PermissionTemplateView,
} from "@/features/access/access-api";
import { useCapabilities } from "@/features/access/use-capabilities";
import { InvitationCard } from "@/features/team/invitation-card";
import { InvitationCodeDialog } from "@/features/team/invitation-code-dialog";
import { InviteMemberDialog } from "@/features/team/invite-member-dialog";
import { MemberCard, type MemberPermissionsState } from "@/features/team/member-card";
import { permissionLabelFromKey } from "@/features/team/permission-labels";
import { roleName } from "@/features/team/role-appearance";
import { RoleCard } from "@/features/team/role-card";
import { RoleDialog } from "@/features/team/role-dialog";
import { RolePermissionsDialog } from "@/features/team/role-permissions-dialog";
import { teamErrorText } from "@/features/team/team-error-text";
import { TeamSectionSwitcher } from "@/features/team/team-section-switcher";
import {
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  type CreatedInvitation,
  type TeamInvitation,
  type TeamMember,
} from "@/features/team/team-api";
import { templateLabel } from "@/features/team/template-labels";
import { useI18n } from "@/i18n/i18n-provider";

type ListState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: T[] };

/** Where the role dialog stands: closed, adding, or editing a given role. */
type RoleDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly role: PermissionTemplateView };

/** The two halves of the page; kept in `?section=` so a refresh or a shared link reopens it. */
type Section = "roles" | "members";

/** Vendor accounts join through a warehouse code and are listed apart from the staff. */
const VENDOR_ROLE = "vendor";

function parseSection(value: string | null): Section {
  return value === "members" ? "members" : "roles";
}

/**
 * Persisting roles is the next phase: until then the dialog is told nothing
 * was saved, and says so. Swap this for the API call when it exists.
 */
const saveRole = (): Promise<boolean> => Promise.resolve(false);

/**
 * Team (settings): roles and the people who hold them, on one page, split
 * into two sections picked from a pair of cards (tabs) under the toolbar.
 *
 * - **Roles** — the permission templates as cards: what each grants, how many
 *   members hold it, and (for `access.manage`) add/edit, which is UI-only until
 *   role persistence lands.
 * - **Team** — every active member as a card with their *effective*
 *   permissions (`GET /access/members/permissions`), so a custom member shows
 *   exactly what they hold rather than just "Custom".
 * - **Vendor accounts** — members holding the `vendor` role, in their own
 *   block under the team, since they are outside partners rather than staff.
 * - **Invitations** — `access.manage` only, as before.
 *
 * Viewing requires `access.read`; every mutation requires `access.manage`.
 * Both are gated here for UX only — the server enforces the same boundary
 * (and the Owner-invite rule) on its own.
 */
export function TeamPage(): ReactNode {
  const { t } = useI18n();
  const { user } = useAuth();
  const { has } = useCapabilities();
  const toast = useToast();

  const companyId = user?.activeCompanyId ?? null;
  const activeMembership = user?.companies.find((c) => c.id === companyId);
  const isOwner = activeMembership?.role === "owner";
  const isManager = activeMembership?.role === "manager";
  const canManage = has({ permission: "access.manage" });

  const [templates, setTemplates] = useState<ListState<PermissionTemplateView>>({
    kind: "loading",
  });
  const [members, setMembers] = useState<ListState<TeamMember>>({ kind: "loading" });
  const [memberPermissions, setMemberPermissions] = useState<
    ReadonlyMap<string, readonly string[]> | "loading" | "error"
  >("loading");
  const [invitations, setInvitations] = useState<ListState<TeamInvitation>>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const section = parseSection(searchParams.get("section"));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState<CreatedInvitation | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [invitationToRevoke, setInvitationToRevoke] = useState<TeamInvitation | null>(null);
  const [roleDialog, setRoleDialog] = useState<RoleDialogState>({ kind: "closed" });
  const [viewingRole, setViewingRole] = useState<PermissionTemplateView | null>(null);

  const loadTemplates = useCallback((): void => {
    setTemplates({ kind: "loading" });
    getPermissionTemplates()
      .then(({ data }) => setTemplates({ kind: "ready", items: data }))
      .catch(() => setTemplates({ kind: "error" }));
  }, []);

  const loadMembers = useCallback((id: string): void => {
    setMembers({ kind: "loading" });
    setMemberPermissions("loading");
    listMembers(id)
      .then(({ data }) => setMembers({ kind: "ready", items: data }))
      .catch(() => setMembers({ kind: "error" }));
    // Separate and best-effort: a failure here only blanks the chips.
    listMemberPermissions()
      .then(({ data }) =>
        setMemberPermissions(new Map(data.map((row) => [row.memberId, row.permissions]))),
      )
      .catch(() => setMemberPermissions("error"));
  }, []);

  const loadInvitations = useCallback((id: string): void => {
    setInvitations({ kind: "loading" });
    listInvitations(id)
      .then(({ data }) => setInvitations({ kind: "ready", items: data }))
      .catch(() => setInvitations({ kind: "error" }));
  }, []);

  useEffect(() => {
    if (companyId === null) return;
    loadTemplates();
    loadMembers(companyId);
    // Invitations are access.manage-gated server-side (unlike members, which
    // only need access.read) — don't fire a request we know will 403.
    if (canManage) loadInvitations(companyId);
  }, [companyId, canManage, loadTemplates, loadMembers, loadInvitations]);

  const memberCountByRole = useMemo(() => {
    const counts = new Map<string, number>();
    if (members.kind === "ready") {
      for (const member of members.items) {
        counts.set(member.role, (counts.get(member.role) ?? 0) + 1);
      }
    }
    return counts;
  }, [members]);

  // Matches what the user reads — translated names, descriptions and
  // permission names — never the API's English or raw keys.
  const visibleTemplates = useMemo(() => {
    if (templates.kind !== "ready") return [];
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0) return templates.items;
    return templates.items.filter((template) => {
      const label = templateLabel(template, t);
      const haystack = [
        label.name,
        label.description ?? "",
        ...template.permissions.map((key) => permissionLabelFromKey(key, t).name),
      ];
      return haystack.some((text) => text.toLocaleLowerCase().includes(needle));
    });
  }, [templates, query, t]);

  const visibleMembers = useMemo(() => {
    if (members.kind !== "ready") return [];
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0) return members.items;
    return members.items.filter((member) =>
      [member.name ?? "", member.email, roleName(member.role, t)].some((text) =>
        text.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [members, query, t]);

  const pendingInvitations =
    invitations.kind === "ready"
      ? invitations.items.filter(
          (invitation) =>
            invitation.status === "pending" &&
            new Date(invitation.expiresAt).getTime() > Date.now(),
        ).length
      : 0;

  // Each section has its own search target, so a term typed for one never
  // silently filters the other.
  const changeSection = (next: string): void => {
    setQuery("");
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set("section", next);
        return params;
      },
      { replace: true },
    );
  };

  const membersMeta = (): string | null => {
    if (members.kind !== "ready") return null;
    const count = t("team.sections.membersCount", { count: members.items.length });
    return canManage && pendingInvitations > 0
      ? `${count} · ${t("team.sections.pendingCount", { count: pendingInvitations })}`
      : count;
  };

  const permissionsOf = (memberId: string): MemberPermissionsState => {
    if (memberPermissions === "loading" || memberPermissions === "error") return memberPermissions;
    return memberPermissions.get(memberId) ?? [];
  };

  const allMembers = members.kind === "ready" ? members.items : [];
  const teamMembers = allMembers.filter((member) => member.role !== VENDOR_ROLE);
  const vendorMembers = allMembers.filter((member) => member.role === VENDOR_ROLE);
  const visibleTeam = visibleMembers.filter((member) => member.role !== VENDOR_ROLE);
  const visibleVendors = visibleMembers.filter((member) => member.role === VENDOR_ROLE);

  const memberGrid = (list: readonly TeamMember[]): ReactNode => (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((member) => (
        <MemberCard
          key={member.id}
          member={member}
          permissions={permissionsOf(member.id)}
          canManage={canManage}
          onRemove={() => setMemberToRemove(member)}
        />
      ))}
    </div>
  );

  if (companyId === null) {
    return (
      <div className="page-surface-sunken mx-auto flex w-full max-w-6xl flex-col gap-6 lg:p-6">
        <ErrorState description={t("team.error.noCompany")} />
      </div>
    );
  }

  return (
    <div className="page-surface-sunken mx-auto flex w-full max-w-6xl flex-col gap-4 lg:gap-6 lg:p-6">
      {/* Desktop only: on a phone the mobile shell already titles the page. */}
      <header className="hidden items-center justify-between gap-4 lg:flex">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <ShieldCheck className="h-6 w-6" />
          </span>
          <PageTitle title={t("team.title")} description={t("team.subtitle")} />
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <Lock className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("team.hero.badge")}</p>
            <p className="text-xs text-muted-foreground">{t("team.hero.badgeHint")}</p>
          </div>
        </div>
      </header>

      <Tabs value={section} onValueChange={changeSection} className="flex flex-col gap-4 lg:gap-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="relative lg:flex-1">
            <Search
              className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(section === "roles" ? "team.roles.search" : "team.members.search")}
              aria-label={t(section === "roles" ? "team.roles.search" : "team.members.search")}
              className="h-11 bg-card ps-9 lg:h-10"
            />
          </div>
          {canManage && section === "roles" ? (
            <Button onClick={() => setRoleDialog({ kind: "add" })} className="h-11 lg:h-10">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("team.roles.add")}
            </Button>
          ) : null}
          {canManage && section === "members" ? (
            <Button onClick={() => setInviteOpen(true)} className="h-11 lg:h-10">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t("team.invite.button")}
            </Button>
          ) : null}
        </div>

        <TeamSectionSwitcher
          label={t("team.sections.label")}
          options={[
            {
              value: "roles",
              icon: ShieldCheck,
              title: t("team.roles.title"),
              description: t("team.sections.rolesDesc"),
              meta:
                templates.kind === "ready"
                  ? t("team.sections.rolesCount", { count: templates.items.length })
                  : null,
            },
            {
              value: "members",
              icon: UsersRound,
              title: t("team.members.section"),
              description: t("team.sections.membersDesc"),
              meta: membersMeta(),
            },
          ]}
        />

        <TabsContent value="roles" className="flex flex-col gap-3 overflow-visible py-0">
          {templates.kind === "loading" ? <LoadingState /> : null}
          {templates.kind === "error" ? <ErrorState onRetry={loadTemplates} /> : null}
          {templates.kind === "ready" && templates.items.length === 0 ? (
            <EmptyState title={t("team.roles.empty")} />
          ) : null}
          {templates.kind === "ready" &&
          templates.items.length > 0 &&
          visibleTemplates.length === 0 ? (
            <EmptyState title={t("team.roles.noMatch")} />
          ) : null}
          {visibleTemplates.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 lg:gap-4">
              {visibleTemplates.map((template) => (
                <RoleCard
                  key={template.key}
                  template={template}
                  memberCount={memberCountByRole.get(template.key) ?? 0}
                  canManage={canManage}
                  onEdit={() => setRoleDialog({ kind: "edit", role: template })}
                  onViewAll={() => setViewingRole(template)}
                />
              ))}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="members" className="flex flex-col gap-6 overflow-visible py-0">
          <div className="flex flex-col gap-3">
            {members.kind === "loading" ? <LoadingState /> : null}
            {members.kind === "error" ? (
              <ErrorState onRetry={() => loadMembers(companyId)} />
            ) : null}
            {members.kind === "ready" && teamMembers.length === 0 ? (
              <EmptyState title={t("team.members.empty")} />
            ) : null}
            {teamMembers.length > 0 && visibleTeam.length === 0 ? (
              <EmptyState title={t("team.members.noMatch")} />
            ) : null}
            {visibleTeam.length > 0 ? memberGrid(visibleTeam) : null}
          </div>

          {members.kind === "ready" ? (
            <section aria-labelledby="team-vendors-heading" className="flex flex-col gap-3">
              <h2
                id="team-vendors-heading"
                className="text-base font-semibold text-foreground lg:text-lg"
              >
                {t("team.vendors.title")}
              </h2>
              {vendorMembers.length === 0 ? <EmptyState title={t("team.vendors.empty")} /> : null}
              {vendorMembers.length > 0 && visibleVendors.length === 0 ? (
                <EmptyState title={t("team.members.noMatch")} />
              ) : null}
              {visibleVendors.length > 0 ? memberGrid(visibleVendors) : null}
            </section>
          ) : null}

          {canManage ? (
            <section aria-labelledby="team-invitations-heading" className="flex flex-col gap-3">
              <h2
                id="team-invitations-heading"
                className="text-base font-semibold text-foreground lg:text-lg"
              >
                {t("team.invitations.title")}
              </h2>
              {invitations.kind === "loading" ? <LoadingState /> : null}
              {invitations.kind === "error" ? (
                <ErrorState onRetry={() => loadInvitations(companyId)} />
              ) : null}
              {invitations.kind === "ready" && invitations.items.length === 0 ? (
                <EmptyState title={t("team.invitations.empty")} />
              ) : null}
              {invitations.kind === "ready" && invitations.items.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {invitations.items.map((invitation) => (
                    <InvitationCard
                      key={invitation.id}
                      invitation={invitation}
                      canManage={canManage}
                      onRevoke={() => setInvitationToRevoke(invitation)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </TabsContent>
      </Tabs>

      <RoleDialog
        open={roleDialog.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) setRoleDialog({ kind: "closed" });
        }}
        role={roleDialog.kind === "edit" ? roleDialog.role : null}
        onSave={saveRole}
      />

      <RolePermissionsDialog
        template={viewingRole}
        onOpenChange={(open) => {
          if (!open) setViewingRole(null);
        }}
      />

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
          role: invitationToRevoke === null ? "" : roleName(invitationToRevoke.role, t),
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
