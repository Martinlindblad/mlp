import axios from 'axios';
import { useQuery } from 'react-query';
import { PersonalInfo } from 'src/types/DBTypes';

const getCollection = () =>
  axios
    .get<PersonalInfo[]>(`/api/introduction`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data[0];
    })
    .catch((err: unknown) => console.log(err));

const useCollectionQuery = () => {
  return useQuery(['getCollection'], () => getCollection());
};

export default useCollectionQuery;
