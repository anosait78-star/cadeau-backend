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
  readonly zoneId: string;
  readonly zoneName: string;
}
