import axios from 'axios';
import { useQuery } from 'react-query';
import { Languages } from 'src/types/DBTypes';

const getLanguages = () =>
  axios
    .get<Languages>(`/api/languages`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch(() => undefined);

const useLanguagesQuery = () => {
  return useQuery(['getLanguages'], () => getLanguages());
};

export default useLanguagesQuery;
