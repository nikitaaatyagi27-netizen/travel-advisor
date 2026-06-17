
import React, { useEffect } from 'react';
import { Box, Typography, Button, Card, CardMedia, CardContent, CardActions, Chip, Rating } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PhoneIcon from '@mui/icons-material/Phone';

const PlaceDetails = ({ place, selected, refProp, highlighted }) => {
  useEffect(() => {
    if (selected) refProp?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected, refProp]);

  const imageUrl =
    place.photo?.images?.large?.url ||
    (place.photos?.length
      ? place.photos[0].getURI()
      : 'https://www.foodserviceandhospitality.com/wp-content/uploads/2016/09/Restaurant-Placeholder-001.jpg');

  const rating = place.rating || 0;
  const reviews = place.num_reviews || place.user_ratings_total || 0;
  const address = place.address || place.vicinity || place.formatted_address;

  

  

  const priceText = { 0: 'Free', 1: '₹', 2: '₹₹', 3: '₹₹₹', 4: '₹₹₹₹' };

  return (
    <Card
      elevation={highlighted ? 12 : 6}
      sx={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '550px',
        border: highlighted ? '2px solid' : '2px solid transparent',
        borderColor: highlighted ? 'primary.main' : 'transparent',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <CardMedia sx={{ height: 250 }} image={imageUrl} title={place.name} />

      <CardContent sx={{ flexGrow: 1 }}>
        <Typography 
          gutterBottom 
          variant="h5" 
          sx={{ 
            minHeight: '64px', 
            display: '-webkit-box', 
            WebkitLineClamp: 2, 
            WebkitBoxOrient: 'vertical', 
            overflow: 'hidden', 
            lineHeight: '1.2em' 
          }}
        >
          {place.name}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', my: 2 }}>
          <Rating value={Number(rating)} readOnly />
          <Typography gutterBottom variant="subtitle1">
            {reviews ? `${reviews} reviews` : 'Rating N/A'}
          </Typography>
        </Box>

        {/* ✅ UNIVERSAL PRICE LOGIC */}
        {(place.price || place.price_level) && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1">Price</Typography>
            <Typography gutterBottom variant="subtitle1">
              {place.price 
                ? place.price 
                : (typeof place.price_level === 'number' 
                    ? priceText[place.price_level] 
                    : place.price_level?.replace('PRICE_LEVEL_', '').toLowerCase())}
            </Typography>
          </Box>
        )}

        {place.ranking && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2">Ranking</Typography>
            <Typography gutterBottom variant="subtitle2">{place.ranking}</Typography>
          </Box>
        )}

        {place?.cuisine?.map(({ name }) => (
          <Chip key={name} size="small" label={name} sx={{ margin: '5px' }} />
        ))}

        {address && (
          <Typography gutterBottom variant="body2" color="textSecondary" sx={{ display: 'flex', alignItems: 'center', mt: 2, minHeight: '40px' }}>
            <LocationOnIcon fontSize="small" sx={{ mr: 1 }} /> {address}
          </Typography>
        )}

        {place.phone && (
          <Typography variant="body2" color="textSecondary" sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
            <PhoneIcon fontSize="small" sx={{ mr: 1 }} /> {place.phone}
          </Typography>
        )}
      </CardContent>

      <CardActions>
        {place.web_url && <Button size="small" color="primary" onClick={() => window.open(place.web_url, '_blank')}>Trip Advisor</Button>}
        {place.url && <Button size="small" color="primary" onClick={() => window.open(place.url, '_blank')}>Google Maps</Button>}
        {place.website && <Button size="small" color="primary" onClick={() => window.open(place.website, '_blank')}>Website</Button>}
      </CardActions>
    </Card>
  );
};

export default PlaceDetails;