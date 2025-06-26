import React, { Fragment, useState, useEffect, useContext } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getWorkerAttendance } from '../../services/attendanceService';
import Table from '../common/Table';
import Spinner from '../common/Spinner';
import { toast } from 'react-toastify';
import appContext from '../../context/AppContext';
import { FaDownload } from 'react-icons/fa';
import Button from '../common/Button';

const AttendanceReport = () => {
    const { user } = useAuth();
    const { subdomain } = useContext(appContext);
    const [attendanceData, setAttendanceData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterDate, setFilterDate] = useState('');
    const [filterName, setFilterName] = useState('');
    const [filterRFID, setFilterRFID] = useState('');
    const [filterDepartment, setFilterDepartment] = useState('');

    useEffect(() => {
        if (!user?.rfid || !subdomain || subdomain === 'main') {
            toast.error("Invalid RFID or subdomain.");
            return;
        }

        const fetchAttendance = async () => {
            setIsLoading(true);
            try {
                const data = await getWorkerAttendance({ rfid: user.rfid, subdomain });
                setAttendanceData(Array.isArray(data.attendance) ? data.attendance : []);
            } catch (error) {
                console.error(error);
                toast.error("Failed to fetch attendance data.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchAttendance();
    }, [user?.rfid, subdomain]);

    const filteredAttendance = attendanceData.filter(record =>
              (!filterDate      || record.date.startsWith(filterDate)) &&
              (!filterName      || record.name.toLowerCase().includes(filterName.toLowerCase())) &&
              (!filterRFID      || record.rfid.includes(filterRFID)) &&
              (!filterDepartment|| record.department.toLowerCase().includes(filterDepartment.toLowerCase()))
            );
        
            const processedAttendance = processAttendanceByDay(filteredAttendance);
    
    // helper to turn “HH:mm:ss” → seconds
    function parseTime(t) {
        if (!t) return 0;
        const [h, m, s] = t.split(':').map(Number);
        return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
    }
  
  // helper to format seconds → “HH:mm:ss”
  function formatSecs(sec) {
    if (isNaN(sec) || sec < 0) {
        return '00:00:00';
    }
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(x => String(x).padStart(2, '0')).join(':');
}
  
  /**
   * groups raw records by date, collects in/out times, and computes duration
   * expects each rec to have { date, time, type: 'IN'|'OUT', name, rfid }
   */
  function processAttendanceByDay(attendanceData) {
    const grouped = {};
    
    // Helper function to parse time and return total minutes from midnight
    function parseTimeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [time, modifier] = timeStr.trim().split(' ');
        if (!time) return 0;
        let [hours, minutes] = time.split(':').map(Number);
        
        if (modifier === 'PM' && hours !== 12) {
            hours += 12;
        } else if (modifier === 'AM' && hours === 12) {
            hours = 0;
        }
        
        return hours * 60 + (minutes || 0);
    }
    
    // Group records by date and RFID
    attendanceData.forEach(record => {
        const dateKey = record.date ? record.date.split('T')[0] : 'Unknown';
        const employeeKey = `${record.rfid || 'Unknown'}_${dateKey}`;
        
        if (!grouped[employeeKey]) {
            grouped[employeeKey] = {
                ...record,
                date: dateKey,
                inTimes: [],
                outTimes: []
            };
        }
        
        // In AttendanceManagement, presence is used. In AttendanceReport, type is used.
        // We will assume 'type' exists in the data for AttendanceReport.
        if (record.type === 'IN' || record.presence) { // Handles both possibilities
            grouped[employeeKey].inTimes.push(record.time);
        } else {
            grouped[employeeKey].outTimes.push(record.time);
        }
    });
    
    // Calculate duration for each day
    Object.keys(grouped).forEach(key => {
        const record = grouped[key];
        const { inTimes, outTimes } = record;
        
        let totalMinutes = 0;
        const minLength = Math.min(inTimes.length, outTimes.length);
        
        for (let i = 0; i < minLength; i++) {
            const inMinutes = parseTimeToMinutes(inTimes[i]);
            const outMinutes = parseTimeToMinutes(outTimes[i]);
            
            let diffMinutes = outMinutes - inMinutes;
            
            if (diffMinutes < 0) {
                diffMinutes += 24 * 60; // Handle midnight crossing
            }
            
            totalMinutes += diffMinutes;
        }
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.floor(totalMinutes % 60);
        
        record.duration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
    });
    
    return Object.values(grouped).sort((a, b) => new Date(b.date) - new Date(a.date));
};
    // Function to download attendance data as CSV
    const downloadAttendanceCSV = () => {
        if (processedAttendance.length === 0) {
            toast.warning("No attendance data to download");
            return;
        }
    
        const headers = [
            'Name',
            'Employee ID',
            'Date',
            'In Times',
            'Out Times',
            'Duration'
        ];
    
        const csvRows = processedAttendance.map(record => [
            record?.name || 'Unknown',
            record?.rfid || 'Unknown',
            record.date || 'Unknown',
            record.inTimes.join(' | '),
            record.outTimes.join(' | '),
            record.duration || '00:00:00'
        ]);
    
        let csvContent = headers.join(',') + '\n';
        csvRows.forEach(row => {
            const formattedRow = row.map(cell => {
                if (cell === null || cell === undefined) return '';
                const cellString = String(cell);
                if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
                    return `"${cellString.replace(/"/g, '""')}"`;
                }
                return cellString;
            });
            csvContent += formattedRow.join(',') + '\n';
        });
    
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
    
        const today = new Date();
        const formattedDate = today.toISOString().split('T')[0];
        const employeeName = user?.name ? user.name.replace(/\s+/g, '_') : 'Employee';
        const dateInfo = filterDate ? `_${filterDate}` : `_${formattedDate}`;
        link.setAttribute('download', `${employeeName}_Attendance_Report${dateInfo}.csv`);
    
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    
        toast.success("Attendance report downloaded successfully!");
    };
    

    const columns = [
        {
            header: 'Name',
            accessor: 'name',
            render: (record) => (
                <div className="flex items-center">
                    {record?.photo && (
                        <img
                            src={record.photo ? record.photo : `https://ui-avatars.com/api/?name=${encodeURIComponent(record.name)}`}
                            alt="Employee"
                            className="w-8 h-8 rounded-full mr-2"
                        />
                    )}
                    {record?.name || 'Unknown'}
                </div>
            )
        },
        {
            header: 'Employee ID',
            accessor: 'rfid',
            render: (record) => record.rfid || 'Unknown'
        },
        
            {
                header: 'Department',
                accessor: 'departmentName',
                render: (record) => record.departmentName || record.department || 'Unknown'
            },
        {
            header: 'Date',
            accessor: 'date',
            render: (record) => record.date || 'Unknown'
        },
        {
            header: 'In Time',
            accessor: 'inTimes',
            render: (record) => (
                <div>
                    {record.inTimes.map((time, index) => (
                        <div key={index} className="text-green-600">{time}</div>
                    ))}
                </div>
            )
        },
        {
            header: 'Out Time',
            accessor: 'outTimes',
            render: (record) => (
                <div>
                    {record.outTimes.map((time, index) => (
                        <div key={index} className="text-red-600">{time}</div>
                    ))}
                </div>
            )
        },
        {
            header: 'Duration',
            accessor: 'duration',
            render: (record) => record.duration || '00:00:00'
        }
    ];
    

    return (
        <Fragment>
            <h1 className='text-2xl font-bold'>Attendance Management</h1>
            <div className='bg-white border rounded-lg p-4'>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <input
                type="text"
                className="form-input"
                placeholder="Search by name..."
                value={filterName}
                onChange={e => setFilterName(e.target.value)}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Filter by RFID..."
                value={filterRFID}
                onChange={e => setFilterRFID(e.target.value)}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Filter by department..."
                value={filterDepartment}
                onChange={e => setFilterDepartment(e.target.value)}
              />
              <input
                type="date"
                className="form-input"
                placeholder="Filter by date..."
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
              />
            </div>
            <div className="flex justify-end mb-6">
              <Button variant="primary" onClick={downloadAttendanceCSV}>
                <FaDownload className="mr-2" /> Download
              </Button>
            </div>
                


                {isLoading ? (
                    <Spinner size="md" variant="default" />
                ) : (
                    <Table
                                      columns={columns}
                                      data={processedAttendance}
                                      noDataMessage="No attendance records found."
                                    />
                )}
            </div>
        </Fragment>
    );
};

export default AttendanceReport;