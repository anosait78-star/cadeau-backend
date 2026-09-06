/** A Bosta city, for the address-mapping picker (Phase C). */
export interface BostaCityView {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
}

/** A Bosta district (grouped under a zone), for the address-mapping picker. */
export interface BostaDistrictView {
  readonly districtId: string;
  readonly districtName: string;
  /** Bosta's own Arabic name for the district (`districtOtherName`, confirmed 2026-09-06). */
  readonly districtNameAr: string | null;
  readonly zoneId: string;
  readonly zoneName: string;
  /** Bosta's own Arabic name for the zone (`zoneOtherName`). */
  readonly zoneNameAr: string | null;
}
