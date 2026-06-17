import axios from 'axios';
import { SERVER_URL } from '../collab/config';

// Fetches places (restaurants/attractions) for a map boundary.
//
// This now calls OUR backend proxy (/api/places) instead of RapidAPI directly. The
// RapidAPI secret key lives only on the server, so it's never shipped to the browser.
// The backend also caches results, so repeated requests for the same area are cheap.
export const getPlacesData = async (type, sw, ne) => {
  try {
    if (sw?.lat && ne?.lat) {
      const { data } = await axios.get(`${SERVER_URL}/api/places`, {
        params: {
          type,
          bl_latitude: sw.lat,
          bl_longitude: sw.lng,
          tr_latitude: ne.lat,
          tr_longitude: ne.lng,
        },
      });

      // The backend already filters out entries missing name/coordinates and returns
      // a plain array of places.
      return data || [];
    }

    return [];
  } catch (error) {
    console.log('Places API Error:', error);
    return [];
  }
};
