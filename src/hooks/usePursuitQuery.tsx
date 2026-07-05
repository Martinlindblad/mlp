import axios from 'axios';
import { useQuery } from 'react-query';
import { Pursuit } from 'src/types/DBTypes';

const getPursuit = () =>
  axios
    .get<Pursuit[]>(`/api/pursuit`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch((err: unknown) => console.error(err));

const usePursuitQuery = () => {
  return useQuery(['getPursuit'], () => getPursuit());
};

export default usePursuitQuery;
