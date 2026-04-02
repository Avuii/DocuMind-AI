import { useEffect, useState } from 'react';
import { listDocuments } from '../api';

const useDocuments = () => {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchDocuments = async () => {
        setLoading(true);
        setError(null);
        try {
            const docs = await listDocuments();
            setDocuments(docs);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDocuments();
    }, []);

    const setStatus = (status) => {
        setDocuments(prev => prev.filter(doc => doc.status === status));
    };

    const refresh = () => {
        fetchDocuments();
    };

    return { documents, loading, error, setStatus, refresh };
};

export default useDocuments;
