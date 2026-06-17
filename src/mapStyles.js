// A muted, minimal map style — soft warm-grey land, gentle roads, quiet labels — so the
// olive/pink/butter UI and the markers stand out instead of competing with loud map colors.
const styles = [
  { elementType: 'geometry', stylers: [{ color: '#f3f1ea' }] }, // warm off-white land
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] }, // hide busy POI icons
  { elementType: 'labels.text.fill', stylers: [{ color: '#9a958a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3f1ea' }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] }, // declutter — we have our own pins
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dfe7d4' }] }, // soft green parks

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#f0eee7' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e9e4d6' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },

  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c8dbe0' }] }, // muted blue water
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8aa6ad' }] },
];

export default styles;
