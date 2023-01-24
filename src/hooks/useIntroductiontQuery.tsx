import axios from 'axios';
import { useQuery } from 'react-query';
import { AboutType } from 'src/../types/DBTypes';

const getAboutData = () =>
  axios
    .get<AboutType[]>(`/api/introduction`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data.find((item) => item.key === 'introduction');
    })
    .catch((err: unknown) => console.log(err));

const useAboutQuery = () => {
  return useQuery(['getAboutData'], () => getAboutData());
};

export default useAboutQuery;
