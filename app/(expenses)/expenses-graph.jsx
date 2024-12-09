import { View, Text, ScrollView, TouchableOpacity, Image, Dimensions, StyleSheet,Alert, Platform } from 'react-native';
import React, { useState, useEffect } from 'react';
import { icons } from "../../constants";
import { router } from "expo-router";
import PieChart from 'react-native-pie-chart';
import { LineChart } from 'react-native-chart-kit';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, getCurrentUser } from "../../lib/firebase";
import { parseDateString } from '../../constants/parseDateString';
import { Loader } from "../../components";
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { formatAmount } from '../../constants/clearAmount';

const screenWidth = Dimensions.get('window').width;

const calculateTotalSpending = (transactions) => {
  return transactions.reduce((total, transaction) => total + parseFloat(transaction.amount), 0);
};

const calculateAverageTransaction = (transactions) => {
  const total = calculateTotalSpending(transactions);
  return transactions.length > 0 ? total / transactions.length : 0;
};

const ExpensesGraph = () => {
  const widthAndHeight = 200;
  const series = [123, 321, 123, 789, 537];
  const sliceColor = ['#fbd203', '#ffb300', '#ff9100', '#ff6c00', '#ff3c00'];
  const seriesNull = [100];
  const sliceColorNull = ['#eeeeee'];
  const [month, setMonth] = useState('');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uniqueMonths, setUniqueMonths] = useState([]);
  const [result, setResult] = useState({ 
    totalAmountsByMonth: [],
    totalAmountsByCategory: [],
    latestTransaction: [],
    budget: 0,
    expenses: 0
  });
  const monthNames = [
    "January", "Febuary", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
  ];
  const [averageSavings, setAverageSavings] = useState(0);

  useEffect(() => {
    const fetchUserData = async () => {
      setLoading(true);
      try {
        const userId = await AsyncStorage.getItem('userId');
        if (!userId) {
          router.push("/sign-in");
          return;
        }

        const userInfo = await getCurrentUser(userId);
        setUser(userInfo);
        setLoading(false);
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  useEffect(() => {
    if (user) {
      const currentMonthTransactions = getCurrentMonthTransactions('current', user.transaction);
      setResult(processTransactions(currentMonthTransactions));

      const avgSaved = calculateAverageSavings(user.transaction);
      const totalSavings = avgSaved.reduce((accumulator, currentValue) => {
        return accumulator + currentValue;
      }, 0);

      const median = calculateMedian(avgSaved);
      console.log(avgSaved);
      setAverageSavings(median.toFixed(2));

      const months = [...new Set(user.transaction.map(transaction => getMonthYear(transaction.timestamp)))];
      const sortedMonths = months.sort((a, b) => new Date(b + '-01') - new Date(a + '-01'));
      setUniqueMonths(sortedMonths);
    }
  }, [user]);

  useEffect(() => {
    if (uniqueMonths.length > 0) {
      setMonth(uniqueMonths[0]); 
    }
  }, [uniqueMonths]);

  const processTransactions = (transactions) => {
    const categoryTotals = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of the day
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999); // End of the day
    let totalExp = 0;
    let totalBudget = 0;

    if (!transactions) return [];

    transactions.forEach(transaction => {
      const amount = parseFloat(transaction.amount);
      const category = transaction.category;

      if (transaction.category === 'Budget')
        totalBudget += amount;
      else
        totalExp += amount;
    });

    transactions.forEach(transaction => {
      const amount = parseInt(transaction.amount, 10);
      const category = transaction.category;

      if (!categoryTotals[category]) {
        categoryTotals[category] = 0;
      }

      categoryTotals[category] += amount;
    });

    const totalByCategory = Object.entries(categoryTotals)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    const totalsArray = Object.values(categoryTotals);

    const todayTransactions = transactions.filter(transaction => {
      const transactionDate = parseDateString(transaction.timestamp);
      return transactionDate >= today && transactionDate <= endOfDay;
    });

    return {
      totalAmountsByMonth: totalsArray,
      totalAmountsByCategory: totalByCategory,
      latestTransaction: todayTransactions,
      expenses: totalExp,
      budget: totalBudget
    };
  };

  const getCurrentMonthTransactions = (dateTransaction, transactions) => {
    if (!transactions) return [];

    const now = new Date();
    let currentYear = now.getUTCFullYear();
    let currentMonth = now.getUTCMonth() + 1;

    if (dateTransaction !== 'current') {
      const getTransDate = dateTransaction.split('-');
      currentYear = parseInt(getTransDate[0], 10);
      currentMonth = parseInt(getTransDate[1], 10);
    }

    const res =  transactions.filter(transaction => {
      const transactionDate = parseDateString(transaction.timestamp);
      return transactionDate.getUTCFullYear() === currentYear && transactionDate.getUTCMonth() + 1 === currentMonth;
    });

    return res;
  };

  const getMonthYear = (dateString) => {
    const transactionDate = parseDateString(dateString);
    const year = transactionDate.getUTCFullYear();
    const month = String(transactionDate.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  const handleValueChange = (itemValue) => {
    if (itemValue === 'all')
    {
      setResult(processTransactions(user.transaction));
      return;
    }

    const currentMonthTransactions = getCurrentMonthTransactions(itemValue, user.transaction);
    setResult(processTransactions(currentMonthTransactions));
  };

  const toMonthName = (date) => {
    const getTransDate = date.split('-');
    currentYear = getTransDate[0];
    currentMonth = parseInt(getTransDate[1], 10) - 1;

    return monthNames[currentMonth] + " " + currentYear;
  }

  const exportExcel = async () => {
    try {
        if (month !== null && month !== undefined && month !== '') {
            const getTransaction = await getCurrentMonthTransactions(month, user.transaction);
    
            const extractedData = getTransaction.map(({ category, notes, amount, timestamp }) => ({
                category,
                notes,
                amount,
                timestamp,
            }));
    
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(extractedData);
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
    
            const buf = new Uint8Array(wbout.length);
            for (let i = 0; i < wbout.length; i++) {
                buf[i] = wbout.charCodeAt(i) & 0xff;
            }
    
            const base64 = btoa(String.fromCharCode.apply(null, buf));
            const fileUri = FileSystem.documentDirectory;
            const fileName = user.fullname + "-" + month + ".xlsx";

            if (Platform.OS === "android") {
              console.log("Fileuri", fileUri + "/" + fileName);
                const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

                if (permissions.granted) {
                    try {
                      const uri = await FileSystem.StorageAccessFramework.createFileAsync(permissions.directoryUri, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

                      console.log("URI", uri);
                      await FileSystem.writeAsStringAsync(uri, base64, {encoding: FileSystem.EncodingType.Base64});
                    } catch (error) {
                      console.log("FileSystem", error);
                    }
                } else {
                    await Sharing.shareAsync(fileUri);
                }
            }
            
            Alert.alert("Saved","File saved successfully.");
        } else {
          Alert.alert("Error","You can't export excel because you don't have transaction yet.");
        }
    } catch (error) {
        console.log("Error:", error.message);
    }
  };

  const getCurrentMonth = () => {
    return new Date().toLocaleString('default', { month: 'long' });
  };

  const calculateAverageSavings = (transactions) => {
    const savingsByMonth = {};
    const currentMonth = getMonthYear(formatDate());

    transactions.forEach(transaction => {
      const yearMonth = getMonthYear(transaction.timestamp);

      if (currentMonth === yearMonth)
      {
        return;
      }

      if (!savingsByMonth[yearMonth]) {
        savingsByMonth[yearMonth] = {
          totalExpenses: 0,
          totalBudget: 0
        };
      }

      // Sum up budget and expenses
      if (transaction.category === "Budget") {
        savingsByMonth[yearMonth].totalBudget += parseFloat(transaction.amount);
      } else {
        savingsByMonth[yearMonth].totalExpenses += parseFloat(transaction.amount);
      }
    });

    const savedPerMonth = [];

    // Calculate savings for each month
    for (const month in savingsByMonth) {
      const { totalBudget, totalExpenses } = savingsByMonth[month];
      const savings = totalBudget - totalExpenses; // Calculate net savings
      savedPerMonth.push(savings);
    }

    return savedPerMonth;
  };

  const calculateMedian = (arr) => {
    const sortedArray = arr.sort((a, b) => a - b);
    const length = sortedArray.length;
    
    if (length % 2 === 0) {
      const mid1 = sortedArray[length / 2 - 1];
      const mid2 = sortedArray[length / 2];
      return (mid1 + mid2) / 2;
    } else {
      return sortedArray[Math.floor(length / 2)];
    }
  }

  const roundDownToHundred = (num) => {
    return Math.floor(num / 100) * 100;
  }

  const formatDate = () => {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    };

    return new Date().toLocaleString('en-US', options);
  };

  return (
    <View style={{ flex: 1 }}>
      <Loader isLoading={loading} />

      <ScrollView className="mt-5" style={{ padding: 20 }}>
        <TouchableOpacity onPress={() => router.push("/view-expenses")} style={{ marginBottom: 20 }}>
          <Image source={icons.leftArrow} resizeMode="contain" style={{ width: 24, height: 24 }} />
        </TouchableOpacity>
        
        <View style={{flexDirection: 'row'}}>
          <Text style={{ fontSize: 18, color: '#5E62AC', marginBottom: 10 }}>
            Expenses Graph
          </Text>
          <Text 
            className="font-pmedium text-sm text-right" 
            style={{color: '#5E62AC', opacity: 100, flex: 1, textDecorationLine: 'underline',}}
            onPress={exportExcel}>
            Export to excel
          </Text>
        </View>

        {(result) && (
            <View style={styles.card} className="mb-5">
              <View className="flex-row">
                <Text className="font-pmedium text-base" style={{ color: '#5E62AC' }}>
                  Potential savings of this {getCurrentMonth()}
                </Text>
              </View>
              <Text className="text-xl font-pregular font-bold">
                {formatAmount(isNaN(roundDownToHundred(averageSavings)) ? 0 : roundDownToHundred(averageSavings))}
              </Text>
            </View>
        )}

        <Picker
          selectedValue={month}
          style={styles.picker}
          onValueChange={(itemValue) => {
            setMonth(itemValue);
            handleValueChange(itemValue);
          }}
        >
          {uniqueMonths.map((item, index) => (
            <Picker.Item key={index} label={toMonthName(item)} value={item} />
          ))}
          <Picker.Item label="All" value="all" />
        </Picker>

        <View className="mt-5" style={{ alignItems: 'center', marginVertical: 20 }}>
          <PieChart
            widthAndHeight={widthAndHeight}
            series={result.totalAmountsByMonth.length === 0 ? seriesNull : result.totalAmountsByMonth}
            sliceColor={result.totalAmountsByMonth.length === 0 ? sliceColorNull : sliceColor.slice(0, result.totalAmountsByMonth.length)}
            coverRadius={0.80}
            coverFill={'#FFF'}
          />
        </View>

        <View className="mb-10">
          {result.totalAmountsByCategory.length === 0 ? (
            <Text style={{ textAlign: 'center', color: 'gray' }}>No Data</Text>
          ) : (
            result.totalAmountsByCategory.map((item, index) => (
              <View key={index} className="border rounded p-3 mt-3 bg-white" style={{borderColor: sliceColor[index], flexDirection: 'row', alignItems: 'center'}}>
                <View style={{ width: 15, height: 15, backgroundColor: sliceColor[index], marginRight: 10 }} />
                <Text className="text-base" style={{ flex: 1 }}>{item.category}</Text>
                <Text className="text-sm font-pregular text-gray">{formatAmount(item.total)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    height: 50,
    width: '100%',
    backgroundColor: 'white'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 10,
    elevation: 5, // For Android shadow
    //shadowColor: '#000', // For iOS shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    width: '100%', // Full width of the screen
    padding: 20,
    marginTop: 20,
  },
});

export default ExpensesGraph;
