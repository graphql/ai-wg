# GraphQL Schema Benchmark Suite

# Goal

Understand LLMs capabilities at writing GraphQL queries given user inputs. Benchmark for different levels of specificity of the prompts as well as different LLM models (aka GPT, Gemini, Claude)

# Schema

\# Complex GraphQL Schema Definition Language (SDL)  
\# Domain: Hotel, Travel, and Experiences Platform

"""  
Notes:  
\- This schema is intentionally large and varied to exercise tooling.  
\- It includes \~100 definitions across object types, interfaces, unions, enums, inputs.  
\- Some types and enums are oversized by design for stress testing.  
"""

schema {  
  query: Query  
  mutation: Mutation  
  subscription: Subscription  
}

"""Common unique identifier"""  
interface Node { id: ID\! }

"""Timestamps for entities"""  
interface Timestamped { createdAt: DateTime\! updatedAt: DateTime\! }

"""Anything that has a money amount"""  
interface Pricable { currency: Currency\! amount: Money\! }

"""Entities that can be booked"""  
interface Bookable implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  title: String\!  
  description: String  
  address: Address\!  
  photos(first: Int \= 20, after: String): PhotoConnection\!  
  averageRating: Float  
  reviewCount: Int\!  
  policies: \[Policy\!\]\!  
  prices(dateRange: DateRangeInput\!): \[Price\!\]\!  
}

"""Entities that accept reviews"""  
interface Reviewable implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  averageRating: Float  
  ratingBreakdown: RatingBreakdown  
  reviews(first: Int \= 20, after: String): ReviewConnection\!  
}

"""Entities that have geo position"""  
interface Locatable { location: Coordinates\! }

\# \===================== Scalars \=====================  
scalar Date  
scalar DateTime  
scalar JSON  
scalar URL

\# \===================== Enums (including large ones) \=====================

enum Currency { USD EUR GBP JPY CNY KRW AUD CAD CHF SEK NOK DKK HKD SGD INR BRL MXN ZAR AED SAR TRY THB VND }

enum Language { en zh fr de es it ja ko tr ru ar pt nl sv da no fi pl he hi id vi th ms uk cs el hu ro sk bg sr hr lt lv et sl fa ur }

enum BedType { TWIN DOUBLE QUEEN KING CALIFORNIA\_KING SOFA\_BED BUNK\_BED FUTON TATAMI ROLLAWAY MURPHY DAYBED }

enum RoomView { CITY GARDEN OCEAN MOUNTAIN RIVER LAKE COURTYARD POOL STREET SKYLINE DESERT FOREST }

enum PaymentMethod { CREDIT\_CARD DEBIT\_CARD APPLE\_PAY GOOGLE\_PAY PAYPAL BANK\_TRANSFER CASH GIFT\_CARD CRYPTO }

enum LoyaltyTier { BASIC SILVER GOLD PLATINUM DIAMOND BLACK }

"""Oversized enum for stress testing. 50 values."""  
enum AmenityCode {  
  WIFI PARKING POOL SPA GYM SAUNA STEAM\_ROOM HOT\_TUB BAR RESTAURANT CAFE ROOM\_SERVICE CONCIERGE AIRPORT\_SHUTTLE PET\_FRIENDLY BEACH\_ACCESS SKI\_IN SKI\_OUT KIDS\_CLUB PLAYGROUND BUSINESS\_CENTER MEETING\_ROOMS CONFERENCE\_HALL LAUNDRY DRY\_CLEANING VALET\_PARKING EV\_CHARGER BICYCLE\_RENTAL CAR\_RENTAL ROOFTOP\_TERRACE GARDEN LOUNGE LIBRARY GAME\_ROOM CINEMA NIGHTCLUB YOGA\_STUDIO TENNIS\_COURT GOLF\_COURSE RUNNING\_TRACK BASKETBALL\_COURT VOLLEYBALL\_COURT SURF\_SCHOOL DIVING\_CENTER BOAT\_RENTAL COOKING\_CLASS WINE\_TASTING ART\_GALLERY GIFT\_SHOP MINI\_BAR SAFE\_BOX  
}

\# \===================== Unions \=====================

union SearchResult \= Hotel | Resort | BoutiqueHotel | Hostel | VacationRental | Experience | Restaurant | Landmark | TransportHub

union Accommodation \= Hotel | Resort | BoutiqueHotel | Hostel | VacationRental

union MediaAttachment \= Photo | Video | VirtualTour

union PaymentInstrument \= CreditCard | PaypalAccount | ApplePayToken | GooglePayToken | BankAccount

union Owner \= Person | Organization

union Addressable \= Hotel | Restaurant | Experience | TransportHub | Landmark

\# \===================== Core Value Types \=====================

type Money { value: Float\! precision: Int\! }

type Coordinates { lat: Float\! lon: Float\! }

type Address { line1: String\! line2: String city: String\! region: String postalCode: String\! country: String\! }

\# \===================== Media and Connections \=====================

type Photo implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  url: URL\!  
  width: Int  
  height: Int  
  alt: String  
  owner: Owner  
}

type Video implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  url: URL\!  
  durationSec: Int\!  
  thumbnail: URL  
}

type VirtualTour implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! url: URL\! provider: String }

\# Relay style connections

type PageInfo { hasNextPage: Boolean\! hasPreviousPage: Boolean\! startCursor: String endCursor: String }

type PhotoEdge { cursor: String\! node: Photo\! }

type PhotoConnection { edges: \[PhotoEdge\!\]\! pageInfo: PageInfo\! totalCount: Int\! }

type ReviewEdge { cursor: String\! node: Review\! }

type ReviewConnection { edges: \[ReviewEdge\!\]\! pageInfo: PageInfo\! totalCount: Int\! }

\# \===================== Policy and Pricing \=====================

type Policy { name: String\! description: String active: Boolean\! }

type CancellationPolicy { refundableUntilHours: Int\! feePercent: Float\! notes: String }

type Fee { code: String\! description: String amount: Money\! currency: Currency\! mandatory: Boolean\! }

type Tax { name: String\! percent: Float\! jurisdiction: String }

type Surcharge { name: String\! amount: Money\! applicableOn: String }

type Price implements Pricable { currency: Currency\! amount: Money\! label: String breakdown: \[Fee\!\] }

\# \===================== Reviews \=====================

type RatingBreakdown { overall: Float cleanliness: Float location: Float service: Float value: Float amenities: Float }

type Review implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  author: User\!  
  rating: Float\!  
  title: String  
  body: String  
  photos: \[Photo\!\]  
  replies: \[ReviewReply\!\]  
}

type ReviewReply { author: User\! body: String createdAt: DateTime\! }

\# \===================== People and Orgs \=====================

type Person implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! email: String phone: String }

type Organization implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! website: URL }

\# \===================== Accommodation Hierarchy \=====================

"""Feature matrix with 60 flags to stress clients"""  
input HotelFeaturesInput {  
  WIFI: Boolean  
  PARKING: Boolean  
  POOL: Boolean  
  SPA: Boolean  
  GYM: Boolean  
  SAUNA: Boolean  
  STEAM\_ROOM: Boolean  
  HOT\_TUB: Boolean  
  BAR: Boolean  
  RESTAURANT: Boolean  
  CAFE: Boolean  
  ROOM\_SERVICE: Boolean  
  CONCIERGE: Boolean  
  AIRPORT\_SHUTTLE: Boolean  
  PET\_FRIENDLY: Boolean  
  BEACH\_ACCESS: Boolean  
  SKI\_IN: Boolean  
  SKI\_OUT: Boolean  
  KIDS\_CLUB: Boolean  
  PLAYGROUND: Boolean  
  BUSINESS\_CENTER: Boolean  
  MEETING\_ROOMS: Boolean  
  CONFERENCE\_HALL: Boolean  
  LAUNDRY: Boolean  
  DRY\_CLEANING: Boolean  
  VALET\_PARKING: Boolean  
  EV\_CHARGER: Boolean  
  BICYCLE\_RENTAL: Boolean  
  CAR\_RENTAL: Boolean  
  ROOFTOP\_TERRACE: Boolean  
  GARDEN: Boolean  
  LOUNGE: Boolean  
  LIBRARY: Boolean  
  GAME\_ROOM: Boolean  
  CINEMA: Boolean  
  NIGHTCLUB: Boolean  
  YOGA\_STUDIO: Boolean  
  TENNIS\_COURT: Boolean  
  GOLF\_COURSE: Boolean  
  RUNNING\_TRACK: Boolean  
  BASKETBALL\_COURT: Boolean  
  VOLLEYBALL\_COURT: Boolean  
  SURF\_SCHOOL: Boolean  
  DIVING\_CENTER: Boolean  
  BOAT\_RENTAL: Boolean  
  COOKING\_CLASS: Boolean  
  WINE\_TASTING: Boolean  
  ART\_GALLERY: Boolean  
  GIFT\_SHOP: Boolean  
  MINI\_BAR: Boolean  
  SAFE\_BOX: Boolean  
  FIREPLACE: Boolean  
  SOUNDPROOFING: Boolean  
  SMART\_TV: Boolean  
  BLACKOUT\_CURTAINS: Boolean  
  BIDET: Boolean  
  HEATED\_FLOORS: Boolean  
  NON\_SMOKING: Boolean  
}

"""Oversized object with 50+ fields"""  
type Hotel implements Node & Timestamped & Bookable & Reviewable & Locatable {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  title: String\!  
  description: String  
  address: Address\!  
  photos(first: Int \= 20, after: String): PhotoConnection\!  
  averageRating: Float  
  reviewCount: Int\!  
  policies: \[Policy\!\]\!  
  prices(dateRange: DateRangeInput\!): \[Price\!\]\!  
  location: Coordinates\!  
  brand: Organization  
  checkInTime: String  
  checkOutTime: String  
  starRating: Int  
  phone: String  
  email: String  
  website: URL  
  amenities: \[Amenity\!\]\!  
  features: HotelFeatures\!  
  rooms(first: Int \= 20, after: String, filter: RoomFilterInput): RoomTypeConnection\!  
  restaurants: \[Restaurant\!\]  
  spas: \[Spa\!\]  
  gyms: \[Gym\!\]  
  pools: \[Pool\!\]  
  parking: Parking  
  transport: \[TransportHub\!\]  
  sustainability: SustainabilityScore  
  safety: SafetyProtocol  
  nearbyAttractions(first: Int \= 20, after: String): NearbyAttractionConnection\!  
  promotions: \[Promotion\!\]  
  events: \[Event\!\]  
  conferenceRooms: \[ConferenceRoom\!\]  
  loyaltyProgram: LoyaltyProgram  
  houseRules: \[String\!\]  
  taxes: \[Tax\!\]  
  surcharges: \[Surcharge\!\]  
  cancellationPolicy: CancellationPolicy  
  paymentMethods: \[PaymentMethod\!\]\!  
  languagesSpoken: \[Language\!\]\!  
  isBoutique: Boolean\!  
  isAdultsOnly: Boolean\!  
  isAllInclusive: Boolean\!  
  isEcoCertified: Boolean\!  
  createdBy: User\!  
  lastModifiedBy: User  
  searchScore: Float  
  tags: \[String\!\]  
  inventoryId: ID  
  timezone: String  
  currency: Currency\!  
}

type HotelFeatures {  
  WIFI: Boolean\!  
  PARKING: Boolean\!  
  POOL: Boolean\!  
  SPA: Boolean\!  
  GYM: Boolean\!  
  SAUNA: Boolean\!  
  STEAM\_ROOM: Boolean\!  
  HOT\_TUB: Boolean\!  
  BAR: Boolean\!  
  RESTAURANT: Boolean\!  
  CAFE: Boolean\!  
  ROOM\_SERVICE: Boolean\!  
  CONCIERGE: Boolean\!  
  AIRPORT\_SHUTTLE: Boolean\!  
  PET\_FRIENDLY: Boolean\!  
  BEACH\_ACCESS: Boolean\!  
  SKI\_IN: Boolean\!  
  SKI\_OUT: Boolean\!  
  KIDS\_CLUB: Boolean\!  
  PLAYGROUND: Boolean\!  
  BUSINESS\_CENTER: Boolean\!  
  MEETING\_ROOMS: Boolean\!  
  CONFERENCE\_HALL: Boolean\!  
  LAUNDRY: Boolean\!  
  DRY\_CLEANING: Boolean\!  
  VALET\_PARKING: Boolean\!  
  EV\_CHARGER: Boolean\!  
  BICYCLE\_RENTAL: Boolean\!  
  CAR\_RENTAL: Boolean\!  
  ROOFTOP\_TERRACE: Boolean\!  
  GARDEN: Boolean\!  
  LOUNGE: Boolean\!  
  LIBRARY: Boolean\!  
  GAME\_ROOM: Boolean\!  
  CINEMA: Boolean\!  
  NIGHTCLUB: Boolean\!  
  YOGA\_STUDIO: Boolean\!  
  TENNIS\_COURT: Boolean\!  
  GOLF\_COURSE: Boolean\!  
  RUNNING\_TRACK: Boolean\!  
  BASKETBALL\_COURT: Boolean\!  
  VOLLEYBALL\_COURT: Boolean\!  
  SURF\_SCHOOL: Boolean\!  
  DIVING\_CENTER: Boolean\!  
  BOAT\_RENTAL: Boolean\!  
  COOKING\_CLASS: Boolean\!  
  WINE\_TASTING: Boolean\!  
  ART\_GALLERY: Boolean\!  
  GIFT\_SHOP: Boolean\!  
  MINI\_BAR: Boolean\!  
  SAFE\_BOX: Boolean\!  
}

\# Additional accommodation subtypes

type Resort implements Node & Timestamped & Bookable & Reviewable & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! title: String\! description: String starRating: Int address: Address\! photos(first: Int \= 20, after: String): PhotoConnection\! averageRating: Float reviewCount: Int\! policies: \[Policy\!\]\! prices(dateRange: DateRangeInput\!): \[Price\!\]\! location: Coordinates\! allInclusive: Boolean\! privateBeach: Boolean }

type BoutiqueHotel implements Node & Timestamped & Bookable & Reviewable & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! title: String\! description: String address: Address\! photos(first: Int \= 20, after: String): PhotoConnection\! averageRating: Float reviewCount: Int\! policies: \[Policy\!\]\! prices(dateRange: DateRangeInput\!): \[Price\!\]\! location: Coordinates\! designTheme: String\! artCollection: Boolean\! }

type Hostel implements Node & Timestamped & Bookable & Reviewable & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! title: String\! description: String address: Address\! photos(first: Int \= 20, after: String): PhotoConnection\! averageRating: Float reviewCount: Int\! policies: \[Policy\!\]\! prices(dateRange: DateRangeInput\!): \[Price\!\]\! location: Coordinates\! dormBeds: Int\! }

type VacationRental implements Node & Timestamped & Bookable & Reviewable & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! title: String\! description: String address: Address\! photos(first: Int \= 20, after: String): PhotoConnection\! averageRating: Float reviewCount: Int\! policies: \[Policy\!\]\! prices(dateRange: DateRangeInput\!): \[Price\!\]\! location: Coordinates\! bedrooms: Int bathrooms: Float hasKitchen: Boolean\! host: Owner }

\# \===================== Rooms \=====================

type RoomType implements Node & Timestamped & Reviewable {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  name: String\!  
  description: String  
  sizeSqm: Float  
  maxOccupancy: Int\!  
  bedTypes: \[BedType\!\]\!  
  view: RoomView  
  amenities: \[Amenity\!\]\!  
  photos(first: Int \= 20, after: String): PhotoConnection\!  
  basePrice: Money\!  
  currency: Currency\!  
  inventory: Int\!  
  policies: \[Policy\!\]  
  cancellationPolicy: CancellationPolicy  
  averageRating: Float  
  ratingBreakdown: RatingBreakdown  
  reviews(first: Int \= 20, after: String): ReviewConnection\!  
}

type RoomTypeEdge { cursor: String\! node: RoomType\! }

type RoomTypeConnection { edges: \[RoomTypeEdge\!\]\! pageInfo: PageInfo\! totalCount: Int\! }

\# \===================== Amenities \=====================

type Amenity { code: AmenityCode\! label: String\! icon: URL }

\# \===================== Facilities and Services \=====================

type Restaurant implements Node & Timestamped & Reviewable & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! address: Address\! location: Coordinates\! cuisines: \[Cuisine\!\]\! menu: \[MenuItem\!\]\! averageRating: Float ratingBreakdown: RatingBreakdown reviews(first: Int \= 20, after: String): ReviewConnection\! }

type Cuisine { name: String\! regional: String }

type MenuItem { name: String\! description: String price: Money\! currency: Currency\! vegetarian: Boolean vegan: Boolean glutenFree: Boolean }

type Spa implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! treatments: \[String\!\]\! }

type Gym implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! open24h: Boolean\! equipment: \[String\!\]\! }

type Pool implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! indoor: Boolean\! heated: Boolean\! lengthMeters: Float }

type Parking { onSite: Boolean\! valet: Boolean\! spaces: Int heightLimitMeters: Float evChargers: Int }

type ConferenceRoom implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! capacity: Int\! areaSqm: Float projector: Boolean\! soundSystem: Boolean\! }

type Event implements Node & Timestamped & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! title: String\! description: String startsAt: DateTime\! endsAt: DateTime\! location: Coordinates\! }

\# \===================== Transport and Nearby \=====================

type TransportHub implements Node & Timestamped & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! type: String\! name: String\! location: Coordinates\! distanceKm: Float }

type NearbyAttraction implements Node & Timestamped & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! category: String\! location: Coordinates\! distanceKm: Float }

type NearbyAttractionEdge { cursor: String\! node: NearbyAttraction\! }

type NearbyAttractionConnection { edges: \[NearbyAttractionEdge\!\]\! pageInfo: PageInfo\! totalCount: Int\! }

type Landmark implements Node & Timestamped & Locatable { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! description: String location: Coordinates\! }

\# \===================== Sustainability and Safety \=====================

type SustainabilityScore { energy: Float water: Float waste: Float certification: EnergyCertificate }

type EnergyCertificate { program: String level: String validUntil: Date }

type SafetyProtocol { fireExtinguishers: Boolean smokeDetectors: Boolean emergencyExits: Int defibrillatorOnSite: Boolean }

\# \===================== Commerce: Users, Cart, Booking, Payments \=====================

type User implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! name: String\! email: String\! phone: String loyalty: LoyaltyAccount }

type LoyaltyAccount { program: String tier: LoyaltyTier points: Int memberSince: Date }

type Cart implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! user: User\! items: \[CartItem\!\]\! currency: Currency\! total: Money\! }

type CartItem { sku: ID\! title: String\! description: String quantity: Int\! unitPrice: Money\! currency: Currency\! }

type Promotion { code: String\! description: String discountPercent: Float active: Boolean }

type Coupon { code: String\! amountOff: Money currency: Currency percentageOff: Float expiresAt: DateTime }

type GiftCard { code: String\! remaining: Money currency: Currency }

type Booking implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  user: User\!  
  item: Accommodation\!  
  room: RoomType  
  guests: \[Guest\!\]\!  
  dateRange: DateRange\!  
  totalPrice: Money\!  
  currency: Currency\!  
  status: BookingStatus\!  
  payments: \[Payment\!\]\!  
  invoice: Invoice  
  notes: String  
}

enum BookingStatus { PENDING CONFIRMED CANCELLED CHECKED\_IN CHECKED\_OUT NO\_SHOW REFUNDED }

type Guest { name: String\! email: String age: Int }

type Payment implements Node & Timestamped {  
  id: ID\!  
  createdAt: DateTime\!  
  updatedAt: DateTime\!  
  method: PaymentMethod\!  
  instrument: PaymentInstrument  
  amount: Money\!  
  currency: Currency\!  
  status: PaymentStatus\!  
}

enum PaymentStatus { AUTHORIZED CAPTURED VOIDED REFUNDED FAILED }

type CreditCard { brand: String last4: String expMonth: Int expYear: Int cardholder: String }

type PaypalAccount { email: String payerId: String }

type ApplePayToken { token: String deviceAccount: String }

type GooglePayToken { token: String }

type BankAccount { bankName: String last4: String iban: String bic: String }

type Refund implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! payment: Payment\! amount: Money\! currency: Currency\! reason: String }

type Invoice implements Node & Timestamped { id: ID\! createdAt: DateTime\! updatedAt: DateTime\! number: String\! issuedTo: User\! lineItems: \[InvoiceLineItem\!\]\! subtotal: Money\! taxes: \[Tax\!\]\! total: Money\! currency: Currency\! pdf: URL }

type InvoiceLineItem { description: String\! quantity: Int\! unitPrice: Money\! }

\# \===================== Inputs \=====================

input PaginationInput { first: Int after: String last: Int before: String }

input DateRangeInput { start: Date\! end: Date\! }

input DateRange { start: Date\! end: Date\! }

input SortInput { field: String\! order: SortOrder\! }

enum SortOrder { ASC DESC }

input GeoBoundingInput { north: Float south: Float east: Float west: Float }

input PriceFilterInput { min: Float max: Float currency: Currency }

input HotelFilterInput {  
  query: String  
  starsMin: Int  
  location: GeoBoundingInput  
  amenitiesAny: \[AmenityCode\!\]  
  price: PriceFilterInput  
  isEcoCertified: Boolean  
  languagesAny: \[Language\!\]  
}

input RoomFilterInput { capacityAtLeast: Int bedTypesAny: \[BedType\!\] viewsAny: \[RoomView\!\] price: PriceFilterInput }

input ReviewCreateInput { targetId: ID\! rating: Float\! title: String body: String photos: \[URL\!\] }

input BookingCreateInput {  
  userId: ID\!  
  itemId: ID\!  
  roomTypeId: ID  
  guests: \[GuestInput\!\]\!  
  dateRange: DateRangeInput\!  
  payment: PaymentInput\!  
  coupon: String  
  notes: String  
}

input GuestInput { name: String\! email: String age: Int }

input PaymentInput { method: PaymentMethod\! instrument: JSON amount: Float\! currency: Currency\! }

input HotelCreateInput {  
  title: String\!  
  description: String  
  address: AddressInput\!  
  location: CoordinatesInput\!  
  currency: Currency\!  
  features: HotelFeaturesInput  
}

input AddressInput { line1: String\! line2: String city: String\! region: String postalCode: String\! country: String\! }

input CoordinatesInput { lat: Float\! lon: Float\! }

input RestaurantCreateInput { name: String\! address: AddressInput\! location: CoordinatesInput\! cuisines: \[String\!\]\! }

input PriceQuoteInput { itemId: ID\! dateRange: DateRangeInput\! guests: Int }

input SearchInput { query: String filters: HotelFilterInput pagination: PaginationInput sort: SortInput }

\# \===================== Query \=====================

type Query {  
  node(id: ID\!): Node  
  search(input: SearchInput\!): \[SearchResult\!\]\!  
  hotels(filter: HotelFilterInput, pagination: PaginationInput, sort: SortInput): \[Hotel\!\]\!  
  hotel(id: ID\!): Hotel  
  roomType(id: ID\!): RoomType  
  me: User  
  booking(id: ID\!): Booking  
  bookings(userId: ID\!, status: BookingStatus): \[Booking\!\]\!  
  recommendations(userId: ID\!, near: CoordinatesInput, limit: Int \= 10): \[SearchResult\!\]\!  
}

\# \===================== Mutation \=====================

type Mutation {  
  createHotel(input: HotelCreateInput\!): Hotel\!  
  createRestaurant(input: RestaurantCreateInput\!): Restaurant\!  
  createReview(input: ReviewCreateInput\!): Review\!  
  createBooking(input: BookingCreateInput\!): Booking\!  
  cancelBooking(id: ID\!, reason: String): Booking\!  
  capturePayment(paymentId: ID\!): Payment\!  
  refundPayment(paymentId: ID\!, amount: Float\!): Refund\!  
  applyCoupon(bookingId: ID\!, code: String\!): Booking\!  
}

\# \===================== Subscription \=====================

type Subscription {  
  bookingStatus(bookingId: ID\!): BookingStatus\!  
  priceChanged(itemId: ID\!): Price\!  
}

# BenchmarkTests

Benchmark for different LLMs: claude vs GPT (mainly)

1.  **Inline fragments on a union (SearchResult)**   
   1. **\[Specific\]** Prompt: “Search and return up to 5 results. If it’s a Hotel or Resort also return starRating; if it’s a Restaurant return cuisines; if it’s a Landmark return description.  
   2. **\[Regular\]** Prompt: Search for accommodations and return useful information depending on the type of result.  
   3. **\[User-like\] Prompt:** Can you find some travel options that match my search and show the most relevant details for each, whether it’s a hotel, restaurant, or landmark?”

```
query SearchResults($q: String!) {
  search(input: { query: $q }) {
    __typename
    ... on Hotel { title starRating }
    ... on Resort { title starRating }
    ... on Restaurant { name cuisines { name } }
    ... on Landmark { name description }
  }
}
```

2. **Casting an interface (Bookable) to concrete types**  
   1. \[**Specific**\] Prompt: “Fetch a specific booking by id and read common Bookable fields of the item, plus type-specific fields: Hotel’s brand name, Resort’s private beach, vacation rental bedrooms.”  
   2. \[**Normal**\] Prompt: Fetch a specific booking by id and retrieve relevant information for that booking, including details specific to the type of stay.  
   3. **\[User-like\]** Prompt: I have a booking — can you show me everything about it, including details that depend on the kind of place it is?”

```
query BookingItemDetails($id: ID!) {
  booking(id: $id) {
    id
    item {
      __typename
      ... on Bookable { title description address { city country } }
      ... on Hotel { brand { name } }
      ... on Resort { privateBeach }
      ... on VacationRental { bedrooms }
    }
  }
}
```

3. **Inline fragments on a union nested inside another type (Payment.instrument)**  
   1. **\[Specific\]** Prompt: For booking payments, show instrument specifics: last 4 of credit card, paypal account email, ApplePay token device account, GooglePay token, bank account.  
   2. **\[Normal\]** Prompt: Get payment details for a booking, showing the right information based on the payment method.  
   3. **\[User-like\]** Prompt: Can you show me how I paid for my booking and include the right information depending on the payment method I used?

```
query BookingPaymentInstruments($id: ID!) {
  booking(id: $id) {
    id
    payments {
      method
      instrument {
        __typename
        ... on CreditCard { brand last4 expMonth expYear }
        ... on PaypalAccount { email }
        ... on ApplePayToken { deviceAccount }
        ... on GooglePayToken { token }
        ... on BankAccount { bankName iban bic }
      }
    }
  }
}
```

4. **Five-level deep traversal \+ connections**  
   1. **\[Specific\]** Prompt: “From a hotel id, go rooms connection → review edges → review author → author loyalty tier. Return hotel.title, first 2 rooms’ names, first 1 review title per room, and the author’s loyalty tier.”  
   2. **\[Normal\]** Prompt: Starting from a hotel, show its rooms, reviews, and reviewer loyalty tiers.  
   3. **\[User-like\]** Prompt: I’m looking at a hotel — can you show me what kinds of rooms it has and what guests have said about them, including the loyalty tier of those reviewers?

```
query DeepHotelTraversal($id: ID!) {
  hotel(id: $id) {
    title
    rooms(first: 2) {
      edges {
        node {
          name
          reviews(first: 1) {
            edges {
              node {
                title
                author {
                  name
                  loyalty { tier }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

5. **Enum filters and oversized enum usage**  
   1. **\[Specific\]** Prompt: “Find eco-certified hotels that offer WIFI or SPA. Return id, title, amenities.”  
   2. **\[Normal\]** Prompt: List eco-friendly hotels that include popular wellness amenities.  
   3. **\[User-like\]** Prompt: Find eco-friendly hotels that offer good wellness options like a spa or strong Wi-Fi.

```
query HotelsWithAmenity {
  hotels(
    filter: {
      isEcoCertified: true
      amenitiesAny: [WIFI, SPA]
    }
  ) {
    id
    title
    amenities { code }
  }
}
```

6. **Input objects \+ range pricing**  
   1. **\[Specific\]** Prompt: “Get prices for a hotel across a date range. Return label and value for each.”  
   2. **\[Normal\]**  Prompt: Show price options for a hotel for a specific period.  
   3. **\[User-like\]** Prompt: What are the prices for a hotel if I stay between two specific dates?”

```
query HotelPriceRange($id: ID!, $start: Date!, $end: Date!) {
  hotel(id: $id) {
    id
    prices(dateRange: { start: $start, end: $end }) {
      label
      amount { value }
      currency
    }
  }
}
```

8. **Pagination with PageInfo and cursors**  
   1. **\[Specific\]** Prompt: “Page through hotel photos in chunks of 3\. Return photo url, cursor, and total number of photos”  
   2. **\[Normal\]** Prompt: Get the first few photos of a hotel and pagination info.  
   3. **\[User-like\]** Prompt: “Show me a few of a hotel’s photos, and include enough info so I can load more later.”

```
query HotelPhotosPage($id: ID!, $first: Int = 3, $after: String) {
  hotel(id: $id) {
    photos(first: $first, after: $after) {
      totalCount
      edges { cursor node { url alt } }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

9. **Sorting and bounding box filters**  
   1. **\[Specific\]** Prompt: List hotels within a bounding box, sorted by descending star rating. Return title, starRating, location.  
   2. **\[Normal\]** Prompt: Find hotels within a region, ordered by their rating.  
   3. **\[User-like\]** Prompt: Can you list hotels in a certain region, ordered from the highest rated to the lowest?

```
query HotelsInBoxSorted(
  $north: Float!, $south: Float!, $east: Float!, $west: Float!
) {
  hotels(
    filter: { location: { north: $north, south: $south, east: $east, west: $west } }
    sort: { field: "starRating", order: DESC }
  ) {
    title
    starRating
    location { lat lon }
  }
}
```

10. **Aliases to disambiguate multiple fields**  
    1. \[Specific\] Prompt: “Fetch the same hotel twice with different filters: rooms by twin beds vs king beds. Return separate aliased fields.”  
    2. \[Normal\] Prompt: Compare how many twin-bed rooms and king-bed rooms a hotel has.  
    3. \[User-like\] Prompt: Can you tell me how many rooms a hotel has with twin beds versus king beds?

```
query RoomVariants($id: ID!) {
  hotel(id: $id) {
    title
    twinRooms: rooms(filter: { bedTypesAny: [TWIN] }) {
      totalCount
    }
    kingRooms: rooms(filter: { bedTypesAny: [KING] }) {
      totalCount
    }
  }
}
```

11. **Mutation with nested inputs (createBooking)**  
    1. **\[Specific\]** Prompt: Create a booking for a hotel room with two guests, specific dates, and a credit card payment.  
    2. **\[Normal\]** Prompt: Book a hotel room for two guests with payment information included.  
    3. **\[User-like\]** Prompt: I’d like to book a hotel room for two guests. Can you make that reservation? 

```
mutation MakeBooking(
  $userId: ID!,
  $itemId: ID!,
  $roomTypeId: ID!,
  $start: Date!,
  $end: Date!
  $guest_inputs: [GuestInput!]!
  $payment: PaymentInput!
  $notes: String
) {
  createBooking(input: {
    userId: $userId
    itemId: $itemId
    roomTypeId: $roomTypeId
    guests: $guest_input
    dateRange: { start: $start, end: $end }
    payment: $payment
    notes: $notes
  }) {
    id
    status
    totalPrice { value }
    currency
  }
}
```

14. **Mutation with enum arguments and refund flow**  
    1. **\[Specific\]** Prompt: “Refund a captured payment by id for a partial amount of 50.0 USD.  
    2. **\[Normal\]** Prompt: Process a partial refund for an existing payment of 50.0 USD  
    3. **\[User-like\]** Prompt: I need to issue a partial refund for a payment of 50.0 USD, can you handle that?

```
mutation RefundPartial($paymentId: ID!) {
  refundPayment(paymentId: $paymentId, amount: 50.0) {
    id
    amount { value }
    currency
    reason
  }
}
```

16. **Subscriptions (priceChanged)**  
    1. **\[Specific\]** Prompt: Subscribe to price changes for an item and return the amount of value and currency.  
    2. **\[Normal\]** Prompt: Watch for price updates on a specific hotel or room.  
    3. **\[User-like\]** Prompt: Let me know whenever the status of my booking changes.

```
subscription OnPriceChanged($itemId: ID!) {
  priceChanged(itemId: $itemId) {
    amount { value }
    currency
    label
  }
}
```

17. **Interface selection set (Reviewable)**  
    1. **\[Specific\]** Prompt: Given a RoomType id, read the interface fields provided by Reviewable plus one type-specific field. Return average rating, rating breakdown, and name.  
    2. **\[Normal\]** Prompt: Retrieve review-related information about a room.  
    3. **\[User-like\]** Prompt: Can you show me how a room is rated and what recent guests have said about it?

```
query RoomReviewable($id: ID!, $first: Int!) {
  roomType(id: $id) {
    ... on Reviewable {
      averageRating
      ratingBreakdown { overall }
      reviews(first: $first) { totalCount }
    }
    name
  }
}
```

18. **Using \_\_typename and conditional directives**  
    1. **\[Specific\]** Prompt: For a search, return title/name only if type is Hotel or Resort. Use @include with a variable flag to optionally include names for Restaurant too.  
    2. **\[Normal\]** Prompt: Perform a search and only include restaurants if being asked to do so.   
    3. **\[User-like\]** Prompt: Search for places and only include restaurant names if I say so.

```
query ConditionalNames($q: String!, $includeRestaurant: Boolean!) {
  search(input: { query: $q }) {
    ... on Hotel { title }
    ... on Resort { title }
    ... on Restaurant @include(if: $includeRestaurant) { name }
  }
}
```

19. **Large field selection and scalar leaves**  
    1. **\[Specific\]** Prompt: From a Hotel id, read many scalar leaves including booleans and arrays: isBoutique, isAllInclusive, languagesSpoken, paymentMethods, timezone.  
    2. **\[Normal\]** Prompt: Display general information about a hotel, including its available languages and accepted payments and more.   
    3. **\[User-like\]** Prompt: “Give me general info about a hotel: whether it’s boutique, all-inclusive, what languages the staff speak, and which payments they accept and more.

```
query HotelScalars($id: ID!) {
  hotel(id: $id) {
    id
    title
    isBoutique
    isAllInclusive
    isEcoCertified
    languagesSpoken
    paymentMethods
    timezone
  }
}
```

20. **Relay-style connection \+ fragments \+ nested object inputs**  
    1. **\[Specific\]** Prompt: List hotels filtered by starsMin is 5 and language is English, then for each hotel list the first 1 room name and base price using a fragment for room fields.  
    2. **\[Normal\]** Prompt: List luxury hotels with English-speaking staff and show their first available room.  
    3. **\[User-like\]** Prompt: Show me five-star hotels where the staff speak English, and include a peek at one of the available rooms.

```
query FiveStarEnglishHotels {

  hotels(
    filter: { starsMin: 5, languagesAny: [en] }
    sort: { field: "searchScore", order: DESC }
  ) {
    id
    title
    rooms(first: 1) {
      edges { node { ...RoomBasic } }
      pageInfo { hasNextPage }
    }
  }
}

fragment RoomBasic on RoomType {
  name
  basePrice { value }
  currency
}

```

