/**
 * Self-contained natural GraphQL server for the "singapore" schema.
 *
 * Architecture: ONE plain JS object per logical entity, with DIRECT references between
 * related entities. Path-independence is free because the same object is shared across
 * all traversal paths.
 *
 * This schema has NO Relay Connection types — all list fields are plain arrays. So we
 * only register resolvers for:
 *  - Root Query fields
 *  - regionByName (enum-keyed lookup)
 * All other fields (scalars, plain lists) are served by the default resolver from source[field].
 */
import { stableHash } from '../seed.ts';
import type { ResolverMap } from '../types.ts';

// ---------------------------------------------------------------------------
// Seed helper — deterministic scalars from entity identity
// ---------------------------------------------------------------------------
function h(key: string) {
    return stableHash(key);
}

// ---------------------------------------------------------------------------
// Shared UvIndex (island-wide singleton; exposed on both island root and per region)
// For NORTH region: value=165, descriptor="Extreme"
// ---------------------------------------------------------------------------
const uvIndexNorth = {
    __typename: 'UvIndex',
    _seed: h('UvIndex#north'),
    value: 165,
    descriptor: 'Extreme',
    timestamp: '2025-06-01T08:00:00.000Z',
};

// Island-wide UV index (for Query.uvIndex) — different from per-region one
const uvIndexIsland = {
    __typename: 'UvIndex',
    _seed: h('UvIndex#island'),
    value: 7,
    descriptor: 'High',
    timestamp: '2025-06-01T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// RegionForecast for CENTRAL region
// Values come from sg-region-forecast.yaml and sg-forecast-and-taxis-COMPOUND.yaml answers
// ---------------------------------------------------------------------------
const forecastCentral = {
    __typename: 'RegionForecast',
    _seed: h('RegionForecast#central'),
    forecast: 'Partly cloudy with isolated showers',
    temperatureHigh: 637,
    temperatureLow: 947,
    humidityHigh: 288,
    humidityLow: 788,
    windDirection: 'Southwest',
    windSpeed: '12',
};

// Generic forecasts for other regions
const forecastNorth = {
    __typename: 'RegionForecast',
    _seed: h('RegionForecast#north'),
    forecast: 'Partly Cloudy',
    temperatureHigh: 33,
    temperatureLow: 25,
    humidityHigh: 90,
    humidityLow: 65,
    windDirection: 'NE',
    windSpeed: '10-20 km/h',
};

const forecastEast = {
    __typename: 'RegionForecast',
    _seed: h('RegionForecast#east'),
    forecast: 'Light Showers',
    temperatureHigh: 31,
    temperatureLow: 24,
    humidityHigh: 85,
    humidityLow: 60,
    windDirection: 'SE',
    windSpeed: '15-25 km/h',
};

const forecastSouth = {
    __typename: 'RegionForecast',
    _seed: h('RegionForecast#south'),
    forecast: 'Thundery Showers',
    temperatureHigh: 30,
    temperatureLow: 23,
    humidityHigh: 95,
    humidityLow: 70,
    windDirection: 'S',
    windSpeed: '20-30 km/h',
};

const forecastWest = {
    __typename: 'RegionForecast',
    _seed: h('RegionForecast#west'),
    forecast: 'Cloudy',
    temperatureHigh: 32,
    temperatureLow: 24,
    humidityHigh: 88,
    humidityLow: 62,
    windDirection: 'W',
    windSpeed: '10-20 km/h',
};

// ---------------------------------------------------------------------------
// AirQualityReading (one per region — only needed for schema completeness)
// ---------------------------------------------------------------------------
function mkAirQuality(regionKey: string) {
    return {
        __typename: 'AirQualityReading',
        _seed: h(`AirQualityReading#${regionKey}`),
        coSubIndex: 5,
        dominantPollutant: 'PM2.5',
        hazardLevel: 'GOOD',
        no2SubIndex: 8,
        o3SubIndex: 12,
        outdoorActivitySafe: true,
        pm10SubIndex: 20,
        pm25: 15,
        pm25SubIndex: 22,
        psiTwentyFourHourly: 45,
        so2SubIndex: 3,
        uvValue: 5,
    };
}

// ---------------------------------------------------------------------------
// Region objects — one per RegionName enum value
// ---------------------------------------------------------------------------
const regionCentral: any = {
    __typename: 'Region',
    _seed: h('Region#CENTRAL'),
    name: 'CENTRAL',
    latitude: 1.3521,
    longitude: 103.8198,
    forecast: forecastCentral,
    uvIndex: uvIndexIsland,
    airQuality: mkAirQuality('central'),
    areas: [],
};

const regionNorth: any = {
    __typename: 'Region',
    _seed: h('Region#NORTH'),
    name: 'NORTH',
    latitude: 1.42,
    longitude: 103.8279,
    forecast: forecastNorth,
    uvIndex: uvIndexNorth,
    airQuality: mkAirQuality('north'),
    areas: [],
};

const regionEast: any = {
    __typename: 'Region',
    _seed: h('Region#EAST'),
    name: 'EAST',
    latitude: 1.35,
    longitude: 103.94,
    forecast: forecastEast,
    uvIndex: uvIndexIsland,
    airQuality: mkAirQuality('east'),
    areas: [],
};

const regionSouth: any = {
    __typename: 'Region',
    _seed: h('Region#SOUTH'),
    name: 'SOUTH',
    latitude: 1.27,
    longitude: 103.82,
    forecast: forecastSouth,
    uvIndex: uvIndexIsland,
    airQuality: mkAirQuality('south'),
    areas: [],
};

const regionWest: any = {
    __typename: 'Region',
    _seed: h('Region#WEST'),
    name: 'WEST',
    latitude: 1.34,
    longitude: 103.7,
    forecast: forecastWest,
    uvIndex: uvIndexIsland,
    airQuality: mkAirQuality('west'),
    areas: [],
};

const regionByNameMap = new Map<string, any>([
    ['CENTRAL', regionCentral],
    ['NORTH', regionNorth],
    ['EAST', regionEast],
    ['SOUTH', regionSouth],
    ['WEST', regionWest],
]);

const allRegions = [regionCentral, regionNorth, regionEast, regionSouth, regionWest];

// ---------------------------------------------------------------------------
// Clinic objects
// sg-clinics-with-phone requires:
//   - name: "Tiong Bahru Family Clinic", telephone: "+65 6552 3000"
//   - name: "Ang Mo Kio Medical Centre", telephone: "+65 6474 9999"
//   - some clinics with telephone: null
// ---------------------------------------------------------------------------
const clinic1: any = {
    __typename: 'Clinic',
    _seed: h('Clinic#1'),
    name: 'Tiong Bahru Family Clinic',
    telephone: '+65 6552 3000',
    programmes: ['CHAS', 'PHPC'],
    latitude: 1.3521,
    longitude: 103.8198,
    licenceType: 'CLINIC',
};

const clinic2: any = {
    __typename: 'Clinic',
    _seed: h('Clinic#2'),
    name: 'Ang Mo Kio Medical Centre',
    telephone: '+65 6474 9999',
    programmes: ['CHAS'],
    latitude: 1.36,
    longitude: 103.83,
    licenceType: 'MEDICAL CLINIC',
};

const clinic3: any = {
    __typename: 'Clinic',
    _seed: h('Clinic#3'),
    name: 'Raffles Medical Clinic',
    telephone: null,
    programmes: [],
    latitude: 1.29,
    longitude: 103.85,
    licenceType: 'CLINIC',
};

const clinic4: any = {
    __typename: 'Clinic',
    _seed: h('Clinic#4'),
    name: 'Ang Mo Kio Polyclinic',
    telephone: null,
    programmes: ['CHAS', 'PHPC', 'DM'],
    latitude: 1.37,
    longitude: 103.846,
    licenceType: 'POLYCLINIC',
};

const clinic5: any = {
    __typename: 'Clinic',
    _seed: h('Clinic#5'),
    name: 'Bedok Family Clinic',
    telephone: null,
    programmes: ['CHAS'],
    latitude: 1.324,
    longitude: 103.93,
    licenceType: 'CLINIC',
};

const allClinics = [clinic1, clinic2, clinic3, clinic4, clinic5];

// ---------------------------------------------------------------------------
// DengueCluster objects
// sg-dengue-clusters-risk requires:
//   - locality: "Bukit Merah", caseCount: 781, homes: 362, public: 49, construction: 869
//   - locality: "Geylang East", caseCount: 989, homes: 504, public: 569, construction: 365
// ---------------------------------------------------------------------------
const dengueCluster1: any = {
    __typename: 'DengueCluster',
    _seed: h('DengueCluster#1'),
    locality: 'Bukit Merah',
    caseCount: 781,
    breedingSitesHomes: 362,
    breedingSitesPublicPlaces: 49,
    breedingSitesConstruction: 869,
};

const dengueCluster2: any = {
    __typename: 'DengueCluster',
    _seed: h('DengueCluster#2'),
    locality: 'Geylang East',
    caseCount: 989,
    breedingSitesHomes: 504,
    breedingSitesPublicPlaces: 569,
    breedingSitesConstruction: 365,
};

const dengueCluster3: any = {
    __typename: 'DengueCluster',
    _seed: h('DengueCluster#3'),
    locality: 'Tampines Street 45',
    caseCount: 23,
    breedingSitesHomes: 12,
    breedingSitesPublicPlaces: 8,
    breedingSitesConstruction: 3,
};

const allDengueClusters = [dengueCluster1, dengueCluster2, dengueCluster3];

// ---------------------------------------------------------------------------
// HawkerCentre objects
// sg-hawker-photos requires:
//   - name: "Golden Mile Food Centre", photoUrl: "https://photos.data.gov.sg/hawker/golden-mile-fc.jpg"
//   - name: "Bedok Corner Market", photoUrl: "https://photos.data.gov.sg/hawker/bedok-corner-market.jpg"
// ---------------------------------------------------------------------------
const hawker1: any = {
    __typename: 'HawkerCentre',
    _seed: h('HawkerCentre#1'),
    name: 'Golden Mile Food Centre',
    photoUrl: 'https://photos.data.gov.sg/hawker/golden-mile-fc.jpg',
    status: 'Existing',
    cookedFoodStalls: 45,
    latitude: 1.308,
    longitude: 103.829,
};

const hawker2: any = {
    __typename: 'HawkerCentre',
    _seed: h('HawkerCentre#2'),
    name: 'Bedok Corner Market',
    photoUrl: 'https://photos.data.gov.sg/hawker/bedok-corner-market.jpg',
    status: 'Existing',
    cookedFoodStalls: 62,
    latitude: 1.35,
    longitude: 103.85,
};

const hawker3: any = {
    __typename: 'HawkerCentre',
    _seed: h('HawkerCentre#3'),
    name: 'Maxwell Food Centre',
    photoUrl: null,
    status: 'Existing',
    cookedFoodStalls: 35,
    latitude: 1.281,
    longitude: 103.844,
};

const hawker4: any = {
    __typename: 'HawkerCentre',
    _seed: h('HawkerCentre#4'),
    name: 'Lau Pa Sat',
    photoUrl: null,
    status: 'Existing',
    cookedFoodStalls: 40,
    latitude: 1.2804,
    longitude: 103.8502,
};

const allHawkerCentres = [hawker1, hawker2, hawker3, hawker4];

// ---------------------------------------------------------------------------
// School objects
// sg-schools-by-zone requires:
//   - name: "Raffles Institution", level: JUNIOR_COLLEGE, zone: "North-East"
//   - name: "Riverside Primary School", level: JUNIOR_COLLEGE, zone: "Central"
// ---------------------------------------------------------------------------
const schoolAddr1: any = {
    __typename: 'Address',
    _seed: h('Address#school1'),
    id: 'addr-school-1',
    block: '1',
    buildingName: null,
    country: 'Singapore',
    district: 'Bishan',
    formatted: '1 Bishan Street 22, Singapore 579778',
    line1: '1 Bishan Street 22',
    line2: null,
    postalCode: '579778',
    streetName: 'Bishan Street 22',
    location: {
        __typename: 'Location',
        _seed: h('Location#school1'),
        latitude: 1.3521,
        longitude: 103.849,
        formatted: '1.352100, 103.849000',
    },
};

const schoolAddr2: any = {
    __typename: 'Address',
    _seed: h('Address#school2'),
    id: 'addr-school-2',
    block: '20',
    buildingName: null,
    country: 'Singapore',
    district: 'Tampines',
    formatted: '20 Tampines Avenue 9, Singapore 529568',
    line1: '20 Tampines Avenue 9',
    line2: null,
    postalCode: '529568',
    streetName: 'Tampines Avenue 9',
    location: {
        __typename: 'Location',
        _seed: h('Location#school2'),
        latitude: 1.354,
        longitude: 103.943,
        formatted: '1.354000, 103.943000',
    },
};

const school1: any = {
    __typename: 'School',
    _seed: h('School#1'),
    name: 'Raffles Institution',
    level: 'JUNIOR_COLLEGE',
    zone: 'North-East',
    specialProgrammes: ['IP'],
    address: schoolAddr1,
};

const school2: any = {
    __typename: 'School',
    _seed: h('School#2'),
    name: 'Riverside Primary School',
    level: 'JUNIOR_COLLEGE',
    zone: 'Central',
    specialProgrammes: ['SAP', 'Autonomous'],
    address: schoolAddr2,
};

const school3: any = {
    __typename: 'School',
    _seed: h('School#3'),
    name: 'Ang Mo Kio Primary School',
    level: 'PRIMARY',
    zone: 'NORTH',
    specialProgrammes: [],
    address: {
        __typename: 'Address',
        _seed: h('Address#school3'),
        id: 'addr-school-3',
        block: '25',
        buildingName: null,
        country: 'Singapore',
        district: 'Ang Mo Kio',
        formatted: '25 Ang Mo Kio Avenue 5, Singapore 569798',
        line1: '25 Ang Mo Kio Avenue 5',
        line2: null,
        postalCode: '569798',
        streetName: 'Ang Mo Kio Avenue 5',
        location: {
            __typename: 'Location',
            _seed: h('Location#school3'),
            latitude: 1.37,
            longitude: 103.846,
            formatted: '1.370000, 103.846000',
        },
    },
};

const school4: any = {
    __typename: 'School',
    _seed: h('School#4'),
    name: 'Bedok Secondary School',
    level: 'SECONDARY',
    zone: 'EAST',
    specialProgrammes: ['Autonomous'],
    address: {
        __typename: 'Address',
        _seed: h('Address#school4'),
        id: 'addr-school-4',
        block: '10',
        buildingName: null,
        country: 'Singapore',
        district: 'Bedok',
        formatted: '10 Bedok North Road, Singapore 469554',
        line1: '10 Bedok North Road',
        line2: null,
        postalCode: '469554',
        streetName: 'Bedok North Road',
        location: {
            __typename: 'Location',
            _seed: h('Location#school4'),
            latitude: 1.324,
            longitude: 103.93,
            formatted: '1.324000, 103.930000',
        },
    },
};

const school5: any = {
    __typename: 'School',
    _seed: h('School#5'),
    name: 'Jurong Mixed Levels Institute',
    level: 'MIXED_LEVELS',
    zone: 'WEST',
    specialProgrammes: ['IP', 'Gifted'],
    address: {
        __typename: 'Address',
        _seed: h('Address#school5'),
        id: 'addr-school-5',
        block: '5',
        buildingName: null,
        country: 'Singapore',
        district: 'Jurong',
        formatted: '5 Jurong West Street 52, Singapore 649296',
        line1: '5 Jurong West Street 52',
        line2: null,
        postalCode: '649296',
        streetName: 'Jurong West Street 52',
        location: {
            __typename: 'Location',
            _seed: h('Location#school5'),
            latitude: 1.348,
            longitude: 103.706,
            formatted: '1.348000, 103.706000',
        },
    },
};

const allSchools = [school1, school2, school3, school4, school5];

// ---------------------------------------------------------------------------
// TrafficCamera objects
// sg-traffic-camera-locations requires:
//   - cameraId: "SG-PIE-0123", imageUrl: "https://traffic.data.gov.sg/cameras/SG-PIE-0123.jpg", lat: 10.9, lon: 65.6
//   - cameraId: "SG-ECP-0047", imageUrl: "https://traffic.data.gov.sg/cameras/SG-ECP-0047.jpg", lat: 52.3, lon: 69.7
// Note: these are synthetic mock coordinates, NOT real Singapore coords
// ---------------------------------------------------------------------------
const camera1: any = {
    __typename: 'TrafficCamera',
    _seed: h('TrafficCamera#1'),
    cameraId: 'SG-PIE-0123',
    imageUrl: 'https://traffic.data.gov.sg/cameras/SG-PIE-0123.jpg',
    latitude: 10.9,
    longitude: 65.6,
    timestamp: '2025-06-01T08:00:00.000Z',
};

const camera2: any = {
    __typename: 'TrafficCamera',
    _seed: h('TrafficCamera#2'),
    cameraId: 'SG-ECP-0047',
    imageUrl: 'https://traffic.data.gov.sg/cameras/SG-ECP-0047.jpg',
    latitude: 52.3,
    longitude: 69.7,
    timestamp: '2025-06-01T08:00:00.000Z',
};

const camera3: any = {
    __typename: 'TrafficCamera',
    _seed: h('TrafficCamera#3'),
    cameraId: '1001',
    imageUrl: 'https://images.data.gov.sg/api/traffic-images/2025/06/camera1001.jpg',
    latitude: 1.3521,
    longitude: 103.8198,
    timestamp: '2025-06-01T08:00:00.000Z',
};

const camera4: any = {
    __typename: 'TrafficCamera',
    _seed: h('TrafficCamera#4'),
    cameraId: '1002',
    imageUrl: 'https://images.data.gov.sg/api/traffic-images/2025/06/camera1002.jpg',
    latitude: 1.36,
    longitude: 103.91,
    timestamp: '2025-06-01T08:00:00.000Z',
};

const allTrafficCameras = [camera1, camera2, camera3, camera4];

// ---------------------------------------------------------------------------
// DayForecast for fourDayForecast
// ---------------------------------------------------------------------------
const dayForecast1: any = {
    __typename: 'DayForecast',
    _seed: h('DayForecast#1'),
    date: '2025-06-01',
    forecast: 'Thundery Showers',
    temperatureHigh: 33,
    temperatureLow: 25,
    humidityHigh: 95,
    humidityLow: 65,
    windDirection: 'S',
    windSpeed: '15-25 km/h',
};

const dayForecast2: any = {
    __typename: 'DayForecast',
    _seed: h('DayForecast#2'),
    date: '2025-06-02',
    forecast: 'Partly Cloudy',
    temperatureHigh: 32,
    temperatureLow: 24,
    humidityHigh: 85,
    humidityLow: 60,
    windDirection: 'SE',
    windSpeed: '10-20 km/h',
};

const dayForecast3: any = {
    __typename: 'DayForecast',
    _seed: h('DayForecast#3'),
    date: '2025-06-03',
    forecast: 'Cloudy',
    temperatureHigh: 31,
    temperatureLow: 24,
    humidityHigh: 88,
    humidityLow: 62,
    windDirection: 'NE',
    windSpeed: '15-25 km/h',
};

const dayForecast4: any = {
    __typename: 'DayForecast',
    _seed: h('DayForecast#4'),
    date: '2025-06-04',
    forecast: 'Light Rain',
    temperatureHigh: 30,
    temperatureLow: 23,
    humidityHigh: 92,
    humidityLow: 68,
    windDirection: 'SW',
    windSpeed: '10-20 km/h',
};

const allFourDayForecast = [dayForecast1, dayForecast2, dayForecast3, dayForecast4];

// ---------------------------------------------------------------------------
// Area objects (minimal — needed for areaByName and areas; no operation tests these)
// ---------------------------------------------------------------------------
const areaTampines: any = {
    __typename: 'Area',
    _seed: h('Area#Tampines'),
    name: 'Tampines',
    latitude: 1.3496,
    longitude: 103.9568,
    forecast: 'Partly Cloudy',
    availableTaxis: 42,
    clinicCount: 8,
    schoolCount: 12,
    dengueRiskLevel: 'MODERATE',
    activeDengueClusters: [dengueCluster3],
    clinics: [clinic5],
    hawkerCentres: [hawker3],
    schools: [school2],
    carparks: [],
    carparkSummary: {
        __typename: 'CarparkSummary',
        _seed: h('CarparkSummary#Tampines'),
        totalCarparks: 5,
        totalLots: 1200,
        totalAvailable: 430,
        occupancyPercent: 64.2,
    },
    mrtStations: [],
    trafficCameras: [camera4],
    population: null,
    resaleSummary: null,
    nearestStation: null,
    recentTransactions: [],
    region: regionEast,
    resaleTransactions: [],
};

const areaBishan: any = {
    __typename: 'Area',
    _seed: h('Area#Bishan'),
    name: 'Bishan',
    latitude: 1.3521,
    longitude: 103.849,
    forecast: 'Thundery Showers',
    availableTaxis: 28,
    clinicCount: 5,
    schoolCount: 7,
    dengueRiskLevel: 'HIGH',
    activeDengueClusters: [dengueCluster1],
    clinics: [clinic1, clinic2],
    hawkerCentres: [hawker1],
    schools: [school1],
    carparks: [],
    carparkSummary: {
        __typename: 'CarparkSummary',
        _seed: h('CarparkSummary#Bishan'),
        totalCarparks: 3,
        totalLots: 800,
        totalAvailable: 210,
        occupancyPercent: 73.8,
    },
    mrtStations: [],
    trafficCameras: [camera1, camera3],
    population: null,
    resaleSummary: null,
    nearestStation: null,
    recentTransactions: [],
    region: regionCentral,
    resaleTransactions: [],
};

const allAreas = [areaTampines, areaBishan];

// Link areas to regions
regionCentral.areas = [areaBishan];
regionNorth.areas = [];
regionEast.areas = [areaTampines];
regionSouth.areas = [];
regionWest.areas = [];

// ---------------------------------------------------------------------------
// Encode/Resolve Address helpers
// ---------------------------------------------------------------------------
const resolvedAddress: any = {
    __typename: 'Address',
    _seed: h('Address#resolved'),
    id: 'resolved-addr-1',
    block: '1',
    buildingName: 'City Hall',
    country: 'Singapore',
    district: 'City',
    formatted: "1 St Andrew's Road, Singapore 178957",
    line1: "1 St Andrew's Road",
    line2: null,
    postalCode: '178957',
    streetName: "St Andrew's Road",
    location: {
        __typename: 'Location',
        _seed: h('Location#resolved'),
        latitude: 1.2931,
        longitude: 103.8558,
        formatted: '1.293100, 103.855800',
    },
};

// ---------------------------------------------------------------------------
// THE RESOLVER MAP
// ---------------------------------------------------------------------------
export const singapore: ResolverMap = {
    Query: {
        // Plain array — default resolver returns source[field] so we just return the array
        allClinics: () => allClinics,
        allDengueClusters: () => allDengueClusters,
        allHawkerCentres: () => allHawkerCentres,
        allSchools: () => allSchools,
        trafficCameras: () => allTrafficCameras,
        regions: () => allRegions,
        areas: () => allAreas,
        fourDayForecast: () => allFourDayForecast,

        // Enum-keyed region lookup
        regionByName: (_src, args) => {
            const name = String(args.name);
            return regionByNameMap.get(name) ?? null;
        },

        // Area lookup by name
        areaByName: (_src, args) => {
            const name = String(args.name).toLowerCase();
            return allAreas.find((a: any) => a.name.toLowerCase() === name) ?? null;
        },

        // Scalar values
        totalAvailableTaxis: () => 496,
        totalPopulation: () => 4000000,

        // UV index (island-wide)
        uvIndex: () => uvIndexIsland,

        // Address encode/resolve
        encodeAddress: (_src, args) => {
            return {
                ...resolvedAddress,
                streetName: String(args.streetName ?? ''),
                block: args.block != null ? String(args.block) : null,
                buildingName: args.buildingName != null ? String(args.buildingName) : null,
                postalCode: args.postalCode != null ? String(args.postalCode) : '',
                formatted: `${args.block ? `Block ${args.block} ` : ''}${args.streetName ?? ''}${args.postalCode ? `, Singapore ${args.postalCode}` : ''}`,
                line1: `${args.block ? `Block ${args.block} ` : ''}${args.streetName ?? ''}`,
            };
        },
        resolveAddress: () => resolvedAddress,
    },
};
