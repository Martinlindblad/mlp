import axios from 'axios';
import { useQuery } from 'react-query';
import { SocailMediaLink } from 'src/types/DBTypes';

const getSocialMediaLinks = () =>
  axios
    .get<SocailMediaLink[]>(`/api/socialmedia`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch((err: unknown) => console.log(err));

const useSocialMediaLinksQuery = () => {
  return useQuery(['getSocialMediaLinks'], () => getSocialMediaLinks());
};

export default useSocialMediaLinksQuery;
